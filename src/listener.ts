import { Container, Contracts, Providers, Enums, Utils as KernelUtils } from "@arkecosystem/core-kernel";
import { BigNumber } from "@arkecosystem/utils";
import { Events } from "./events";

@Container.injectable()
export class Listener {
    @Container.inject(Container.Identifiers.Application)
    private readonly app!: Contracts.Kernel.Application;

    @Container.inject(Container.Identifiers.PluginConfiguration)
    @Container.tagged("plugin", "@eugeneli/core-alerter")
    private readonly configuration!: Providers.PluginConfiguration;

    @Container.inject(Container.Identifiers.WalletRepository)
    @Container.tagged("state", "blockchain")
    private readonly walletRepository!: Contracts.State.WalletRepository;

    @Container.inject(Container.Identifiers.LogService)
    private readonly logger!: Contracts.Kernel.Logger;

    @Container.inject(Container.Identifiers.EventDispatcherService)
    private readonly events!: Contracts.Kernel.EventDispatcher;

    private enabled: boolean;
    private webhook: string;
    private forgingThreshold: number;
    private delegateConfigs: Map<string, any> = new Map<string, string>();
    private delegateToRank: Map<string, number> = new Map<string, number>();
    private delegateToVotes: Map<string, number> = new Map<string, number>();
    private delegateToMargin: Map<string, BigNumber> = new Map<string, BigNumber>();

    public async boot(): Promise<void> {
        try {
            await this.init();

            if (!this.enabled) {
                return;
            }

            this.notifyMissedBlock = this.notifyMissedBlock.bind(this);
            this.notifyRankChange = this.notifyRankChange.bind(this);
            this.events.listen(Enums.ForgerEvent.Missing, { handle: this.notifyMissedBlock });
            this.events.listen(Enums.RoundEvent.Applied, { handle: this.notifyRankChange });

            this.logger.info(`[Plugin] Event Alerter started!`);
        }
        catch(error) {
            this.logger.error(error);
            this.logger.error(`[Plugin] Event Alerter failed to start!`);
        }
    }

    private async init() {
        this.enabled = this.configuration.get("enabled");
        if (!this.enabled) {
            return; 
        }

        this.delegateConfigs = new Map<string, string>((this.configuration.get("delegates") as any[])
            .map(delegate => [ delegate.name, delegate ])
        );

        // Initialize watched delegates' ranks
        const delegates: any[] = await this.getDelegates();
        delegates.forEach(delegate => {
            if (this.delegateConfigs.has(delegate.name)) {
                this.delegateToRank.set(delegate.name, delegate.rank);
                this.delegateToVotes.set(delegate.name, delegate.votes);
            }
        });
        
        this.webhook = this.configuration.get("discord.webhook");
        this.forgingThreshold = this.configuration.get("forgingThreshold");
    }

    // TODO: Break out event handling into other modules
    private async notifyRankChange() {
        const noLongerForging: string[] = [];
        const forgingAgain: string[] = [];
        const newRanks: any[] = [];
        const dropOutWarnings: any[] = [];
        const delegates: any[] = await this.getDelegates();

        Array.from(this.delegateConfigs.keys()).forEach(name => {
            // If we never cached this delegate name's rank, it means we never found it to be an active delegate
            if (!this.delegateToRank.has(name)) {
                return;
            }

            const config = this.delegateConfigs.get(name);

            const rank = this.getRank(delegates, name);
            const prevRank = this.delegateToRank.get(name);

            const votes = this.getVotes(delegates, name);
            const prevMargin = this.delegateToMargin.get(name);

            // Check ranks
            if (rank > this.forgingThreshold && prevRank <= this.forgingThreshold) {
                noLongerForging.push(name);
            } else if (rank <= this.forgingThreshold && prevRank > this.forgingThreshold ) {
                forgingAgain.push(name);
            } else if (rank !== prevRank) {
                newRanks.push({
                    name,
                    prevRank,
                    rank
                });
            }

            // Check margin to dropping below forging threshold if still forging
            // and if margin is less than 5% below previous margin to prevent alerting on small diffs
            const margin = votes.minus(delegates[this.forgingThreshold].votes).minus(1);
            if (rank <= this.forgingThreshold && margin.isGreaterThanEqual(0)) {
                if (margin.isLessThanEqual(BigNumber.SATOSHI.times(config.dropOutMargin)) && 
                    (!prevMargin || margin.isLessThan(prevMargin.times(95n/100n)))) {
                    dropOutWarnings.push({
                        name,
                        margin
                    });
                }
            }

            // Update rank, votes, and margin
            this.delegateToRank.set(name, rank);
            this.delegateToVotes.set(name, votes);
            this.delegateToMargin.set(name, margin);
        });

        let noLongerForgingMsg = "";
        let forgingAgainMsg = "";
        let rankChangeMsg = "";
        let dropOutMsg = "";

        noLongerForging.forEach(name => {
            const config = this.delegateConfigs.get(name);
            if (config.messageOn.includes(Events.FORGING_CHANGED)) {
                noLongerForgingMsg += `🚫 **${name}** is no longer forging! ${this.getPing(config, Events.FORGING_CHANGED)} \n`;
            }
        });

        forgingAgain.forEach(name => {
            const config = this.delegateConfigs.get(name);
            if (config.messageOn.includes(Events.FORGING_CHANGED)) {
                forgingAgainMsg += `🎉 **${name}** is forging! ${this.getPing(config, Events.FORGING_CHANGED)} \n`;
            }
        });

        newRanks.forEach(rankData => {
            const config = this.delegateConfigs.get(rankData.name);
            if (config.messageOn.includes(Events.RANK_CHANGED)) {
                rankChangeMsg += `⚠️ **${rankData.name}** changed ranks! (${rankData.prevRank} ➡️ ${rankData.rank}) ${this.getPing(config, Events.RANK_CHANGED)} \n`;
            }
        });

        dropOutWarnings.forEach(dropOutData => {
            const config = this.delegateConfigs.get(dropOutData.name);
            if (config.messageOn.includes(Events.DROPOUT_WARNING)) {
                dropOutMsg += `⚠️ **${dropOutData.name}** is ${dropOutData.margin.dividedBy(BigNumber.SATOSHI)} votes from dropping out! ${this.getPing(config, Events.DROPOUT_WARNING)} \n`;
            }
        });

        if (noLongerForging.length > 0) {
            this.pingDiscord(noLongerForgingMsg);
        }
        if (forgingAgain.length > 0) {
            this.pingDiscord(forgingAgainMsg);    
        }
        if (newRanks.length > 0) {
            this.pingDiscord(rankChangeMsg);
        }
        if (dropOutWarnings.length > 0) {
            this.pingDiscord(dropOutMsg);
        }
    }

    // Returns empty string if ping is not required
    private getPing(config: any, event: string): string {
        if (config.pingOn.includes(event)) {
            return `<@${config.discordId}>`
        } else {
            return "";
        }
    }

    private notifyMissedBlock(payload: any): void {
        const wallet = payload.data;
        const delegateName = wallet.delegate.getAttribute("delegate.username");
        const config = this.delegateConfigs.get(delegateName);

        if (config.messageOn.includes(Events.MISSED_BLOCK)) {
            let missedMsg = `❌ Delegate **${delegateName}** just missed a block!`;

            this.logger.warning(`[Plugin] Event Alerter: ${missedMsg}`);

            missedMsg += this.getPing(config, Events.MISSED_BLOCK);
            this.pingDiscord(missedMsg);
        }
    }

    private pingDiscord(msg) {
        this.logger.info(msg);
        KernelUtils.http.post(this.webhook, {
            body: { content: msg },
            headers: { "Content-Type": "application/json" },
        }).catch(error => {
            this.logger.warning(`[Plugin] Event Alerter: Ping failed!`);
            this.logger.error(error);
        });  
    }

    private findDelegate(delegates: any[], name: string) {
        const filtered = delegates.filter(delegate => delegate.name === name);
        if (filtered.length === 1) {
            return filtered[0];
        } else {
            this.logger.error(`Requested delegate: ${name} not found`);
        }
    }

    private getRank(delegates: any[], name: string) {
        return this.findDelegate(delegates, name).rank;
    }

    private getVotes(delegates: any[], name: string) {
        return this.findDelegate(delegates, name).votes;
    }

    private async getDelegates() {
        const delegates: readonly Contracts.State.Wallet[] = await this.walletRepository.allByUsername();
        return [...delegates]
            .sort((a, b) => b.getAttribute("delegate.voteBalance")
                .comparedTo(a.getAttribute("delegate.voteBalance")))
            .map((wallet, index) => {
                return {
                    name: wallet.getAttribute("delegate.username"),
                    rank: index + 1,
                    votes: wallet.getAttribute("delegate.voteBalance")
                }    
            });
    }
}
