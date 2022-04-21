"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Listener = void 0;
const core_kernel_1 = require("@arkecosystem/core-kernel");
const utils_1 = require("@arkecosystem/utils");
const events_1 = require("./events");
let Listener = class Listener {
    constructor() {
        this.delegateConfigs = new Map();
        this.delegateToRank = new Map();
        this.delegateToVotes = new Map();
        this.delegateToMargin = new Map();
    }
    async boot() {
        try {
            await this.init();
            if (!this.enabled) {
                return;
            }
            this.notifyMissedBlock = this.notifyMissedBlock.bind(this);
            this.notifyRankChange = this.notifyRankChange.bind(this);
            this.events.listen(core_kernel_1.Enums.ForgerEvent.Missing, { handle: this.notifyMissedBlock });
            this.events.listen(core_kernel_1.Enums.RoundEvent.Applied, { handle: this.notifyRankChange });
            this.logger.info(`[Plugin] Event Alerter started!`);
        }
        catch (error) {
            this.logger.error(error);
            this.logger.error(`[Plugin] Event Alerter failed to start!`);
        }
    }
    async init() {
        this.enabled = this.configuration.get("enabled");
        if (!this.enabled) {
            return;
        }
        this.delegateConfigs = new Map(this.configuration.get("delegates")
            .map(delegate => [delegate.name, delegate]));
        // Initialize watched delegates' ranks
        const delegates = await this.getDelegates();
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
    async notifyRankChange() {
        const noLongerForging = [];
        const forgingAgain = [];
        const newRanks = [];
        const dropOutWarnings = [];
        const delegates = await this.getDelegates();
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
            }
            else if (rank <= this.forgingThreshold && prevRank > this.forgingThreshold) {
                forgingAgain.push(name);
            }
            else if (rank !== prevRank) {
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
                if (margin.isLessThanEqual(utils_1.BigNumber.SATOSHI.times(config.dropOutMargin)) &&
                    (!prevMargin || margin.isLessThan(prevMargin.times(95n / 100n)))) {
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
            if (config.messageOn.includes(events_1.Events.FORGING_CHANGED)) {
                noLongerForgingMsg += `🚫 **${name}** is no longer forging! ${this.getPing(config, events_1.Events.FORGING_CHANGED)} \n`;
            }
        });
        forgingAgain.forEach(name => {
            const config = this.delegateConfigs.get(name);
            if (config.messageOn.includes(events_1.Events.FORGING_CHANGED)) {
                forgingAgainMsg += `🎉 **${name}** is forging! ${this.getPing(config, events_1.Events.FORGING_CHANGED)} \n`;
            }
        });
        newRanks.forEach(rankData => {
            const config = this.delegateConfigs.get(rankData.name);
            if (config.messageOn.includes(events_1.Events.RANK_CHANGED)) {
                rankChangeMsg += `⚠️ **${rankData.name}** changed ranks! (${rankData.prevRank} ➡️ ${rankData.rank}) ${this.getPing(config, events_1.Events.RANK_CHANGED)} \n`;
            }
        });
        dropOutWarnings.forEach(dropOutData => {
            const config = this.delegateConfigs.get(dropOutData.name);
            if (config.messageOn.includes(events_1.Events.DROPOUT_WARNING)) {
                dropOutMsg += `⚠️ **${dropOutData.name}** is ${dropOutData.margin.dividedBy(utils_1.BigNumber.SATOSHI)} votes from dropping out! ${this.getPing(config, events_1.Events.DROPOUT_WARNING)} \n`;
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
    getPing(config, event) {
        if (config.pingOn.includes(event)) {
            return `<@${config.discordId}>`;
        }
        else {
            return "";
        }
    }
    notifyMissedBlock(payload) {
        const wallet = payload.data;
        const delegateName = wallet.delegate.getAttribute("delegate.username");
        const config = this.delegateConfigs.get(delegateName);
        if (config.messageOn.includes(events_1.Events.MISSED_BLOCK)) {
            let missedMsg = `❌ Delegate **${delegateName}** just missed a block!`;
            this.logger.warning(`[Plugin] Event Alerter: ${missedMsg}`);
            missedMsg += this.getPing(config, events_1.Events.MISSED_BLOCK);
            this.pingDiscord(missedMsg);
        }
    }
    pingDiscord(msg) {
        this.logger.info(msg);
        core_kernel_1.Utils.http.post(this.webhook, {
            body: { content: msg },
            headers: { "Content-Type": "application/json" },
        }).catch(error => {
            this.logger.warning(`[Plugin] Event Alerter: Ping failed!`);
            this.logger.error(error);
        });
    }
    findDelegate(delegates, name) {
        const filtered = delegates.filter(delegate => delegate.name === name);
        if (filtered.length === 1) {
            return filtered[0];
        }
        else {
            this.logger.error(`Requested delegate: ${name} not found`);
        }
    }
    getRank(delegates, name) {
        return this.findDelegate(delegates, name).rank;
    }
    getVotes(delegates, name) {
        return this.findDelegate(delegates, name).votes;
    }
    async getDelegates() {
        const delegates = await this.walletRepository.allByUsername();
        return [...delegates]
            .sort((a, b) => b.getAttribute("delegate.voteBalance")
            .comparedTo(a.getAttribute("delegate.voteBalance")))
            .map((wallet, index) => {
            return {
                name: wallet.getAttribute("delegate.username"),
                rank: index + 1,
                votes: wallet.getAttribute("delegate.voteBalance")
            };
        });
    }
};
__decorate([
    core_kernel_1.Container.inject(core_kernel_1.Container.Identifiers.Application)
], Listener.prototype, "app", void 0);
__decorate([
    core_kernel_1.Container.inject(core_kernel_1.Container.Identifiers.PluginConfiguration),
    core_kernel_1.Container.tagged("plugin", "@eugeneli/core-alerter")
], Listener.prototype, "configuration", void 0);
__decorate([
    core_kernel_1.Container.inject(core_kernel_1.Container.Identifiers.WalletRepository),
    core_kernel_1.Container.tagged("state", "blockchain")
], Listener.prototype, "walletRepository", void 0);
__decorate([
    core_kernel_1.Container.inject(core_kernel_1.Container.Identifiers.LogService)
], Listener.prototype, "logger", void 0);
__decorate([
    core_kernel_1.Container.inject(core_kernel_1.Container.Identifiers.EventDispatcherService)
], Listener.prototype, "events", void 0);
Listener = __decorate([
    core_kernel_1.Container.injectable()
], Listener);
exports.Listener = Listener;
