import { Container, Contracts, Providers, Enums, Services, Utils as KernelUtils } from "@arkecosystem/core-kernel";

@Container.injectable()
export class Listener {
    @Container.inject(Container.Identifiers.Application)
    private readonly app!: Contracts.Kernel.Application;

    @Container.inject(Container.Identifiers.PluginConfiguration)
    @Container.tagged("plugin", "@eugeneli/core-alerter")
    private readonly configuration!: Providers.PluginConfiguration;

    @Container.inject(Container.Identifiers.LogService)
    private readonly logger!: Contracts.Kernel.Logger;

    @Container.inject(Container.Identifiers.TriggerService)
    private readonly triggers!: Services.Triggers.Triggers;

    @Container.inject(Container.Identifiers.EventDispatcherService)
    private readonly events!: Contracts.Kernel.EventDispatcher;

    private enabled: boolean;
    private webhook: string;
    private forgingThreshold: number;
    private watchedDelegates: Map<string, string> = new Map<string, string>();
    private delegateToRank: Map<string, number> = new Map<string, number>();

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

        this.watchedDelegates = new Map<string, string>((this.configuration.get("delegates") as any[])
            .map(delegate => [ delegate.name, delegate.discordId ])
        );

        // Initialize watched delegates' ranks
        const activeDelegates: any[] = await this.getActiveDelegates();
        activeDelegates.forEach(delegate => {
            if (this.watchedDelegates.has(delegate.name)) {
                this.delegateToRank.set(delegate.name, delegate.rank);
            }
        });
        
        this.webhook = this.configuration.get("discord.webhook");
        this.forgingThreshold = this.configuration.get("forgingThreshold");
    }

    private async notifyRankChange() {
        const noLongerForging: string[] = [];
        const forgingAgain: string[] = [];
        const newRanks: any[] = [];
        const activeDelegates: any[] = await this.getActiveDelegates();

        Array.from(this.watchedDelegates.keys()).forEach(name => {
            // If we never cached this delegate name's rank, it means we never found it to be an active delegate
            if (!this.delegateToRank.has(name)) {
                return;
            }
            const rank = this.getRank(activeDelegates, name);
            const prevRank = this.delegateToRank.get(name);

            // Update rank
            this.delegateToRank.set(name, rank);

            if (rank > this.forgingThreshold && prevRank <= this.forgingThreshold) {
                noLongerForging.push(name);
            } else if (rank !== -1 && rank <= this.forgingThreshold && prevRank > this.forgingThreshold ) {
                forgingAgain.push(name);
            } else if (rank !== prevRank) {
                newRanks.push({
                    name,
                    prevRank,
                    rank
                });
            }
        });

        let noLongerForgingMsg = "";
        let forgingAgainMsg = "";
        let rankChangeMsg = "";

        noLongerForging.forEach(name => {
            noLongerForgingMsg += `🚫 **${name}** is no longer forging! <@${this.watchedDelegates.get(name)}> \n`;
        });

        forgingAgain.forEach(name => {
            forgingAgainMsg += `🎉 **${name}** is forging! <@${this.watchedDelegates.get(name)}> \n`;
        });

        newRanks.forEach(delegateRank => {
            rankChangeMsg += `⚠️ **${delegateRank.name}** changed ranks! (${delegateRank.prevRank} ➡️ ${delegateRank.rank}) <@${this.watchedDelegates.get(delegateRank.name)}> \n`;
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
    }

    private notifyMissedBlock(payload: any): void {
        const wallet = payload.data;
        const delegateName = wallet.delegate.getAttribute("delegate.username");
        let missedMsg = `❌ Delegate **${delegateName}** just missed a block!`;

        this.logger.warning(`[Plugin] Event Alerter: ${missedMsg}`);

        if (this.watchedDelegates.has(delegateName)) {
            missedMsg += `<@${this.watchedDelegates.get(delegateName)}>`;
        } else {
            return;
        }

        this.pingDiscord(missedMsg);
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

    private getRank(activeDelegates: any[], name: string) {
        const filtered = activeDelegates.filter(delegate => delegate.name === name);
        return filtered.length === 1 ? filtered[0].rank : -1;
    }

    private async getActiveDelegates() {
        const activeDelegates: Contracts.State.Wallet[] = await this.triggers.call(
            "getActiveDelegates",
            {},
        );
        if (!activeDelegates) {
            return [];
        }
        return activeDelegates.map((wallet) => {
            return {
                name: wallet.getAttribute("delegate.username"),
                rank: wallet.getAttribute("delegate.rank")
            }
        });
    }
}
