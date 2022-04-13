"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Listener = void 0;
const core_kernel_1 = require("@arkecosystem/core-kernel");
let Listener = class Listener {
    constructor() {
        this.watchedDelegates = new Map();
        this.delegateToRank = new Map();
    }
    boot() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.init();
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
        });
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            this.enabled = this.configuration.get("enabled");
            if (!this.enabled) {
                return;
            }
            this.watchedDelegates = new Map(this.configuration.get("delegates")
                .map(delegate => [delegate.name, delegate.discordId]));
            // Initialize watched delegates' ranks
            const delegates = yield this.getDelegates();
            delegates.forEach(delegate => {
                if (this.watchedDelegates.has(delegate.name)) {
                    this.delegateToRank.set(delegate.name, delegate.rank);
                }
            });
            this.webhook = this.configuration.get("discord.webhook");
            this.forgingThreshold = this.configuration.get("forgingThreshold");
        });
    }
    notifyRankChange() {
        return __awaiter(this, void 0, void 0, function* () {
            const noLongerForging = [];
            const forgingAgain = [];
            const newRanks = [];
            const delegates = yield this.getDelegates();
            Array.from(this.watchedDelegates.keys()).forEach(name => {
                // If we never cached this delegate name's rank, it means we never found it to be an active delegate
                if (!this.delegateToRank.has(name)) {
                    return;
                }
                const rank = this.getRank(delegates, name);
                const prevRank = this.delegateToRank.get(name);
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
                // Update rank
                this.delegateToRank.set(name, rank);
            });
            let noLongerForgingMsg = "";
            let forgingAgainMsg = "";
            let rankChangeMsg = "";
            noLongerForging.forEach(name => {
                noLongerForgingMsg += `🚫 **${name}** is no longer forging! ${this.getPing(this.watchedDelegates.get(name))} \n`;
            });
            forgingAgain.forEach(name => {
                forgingAgainMsg += `🎉 **${name}** is forging! ${this.getPing(this.watchedDelegates.get(name))} \n`;
            });
            newRanks.forEach(delegateRank => {
                rankChangeMsg += `⚠️ **${delegateRank.name}** changed ranks! (${delegateRank.prevRank} ➡️ ${delegateRank.rank}) ${this.getPing(this.watchedDelegates.get(delegateRank.name))} \n`;
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
        });
    }
    getPing(discordId) {
        return discordId !== "" ? `<@${discordId}>` : "";
    }
    notifyMissedBlock(payload) {
        const wallet = payload.data;
        const delegateName = wallet.delegate.getAttribute("delegate.username");
        let missedMsg = `❌ Delegate **${delegateName}** just missed a block!`;
        this.logger.warning(`[Plugin] Event Alerter: ${missedMsg}`);
        if (this.watchedDelegates.has(delegateName)) {
            missedMsg += `<@${this.watchedDelegates.get(delegateName)}>`;
        }
        else {
            return;
        }
        this.pingDiscord(missedMsg);
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
    getRank(delegates, name) {
        const filtered = delegates.filter(delegate => delegate.name === name);
        return filtered.length === 1 ? filtered[0].rank : null;
    }
    getDelegates() {
        return __awaiter(this, void 0, void 0, function* () {
            const delegates = yield this.walletRepository.allByUsername();
            return [...delegates]
                .sort((a, b) => b.getAttribute("delegate.voteBalance")
                .comparedTo(a.getAttribute("delegate.voteBalance")))
                .map((wallet, index) => {
                return {
                    name: wallet.getAttribute("delegate.username"),
                    rank: index + 1
                };
            });
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
    core_kernel_1.Container.inject(core_kernel_1.Container.Identifiers.TriggerService)
], Listener.prototype, "triggers", void 0);
__decorate([
    core_kernel_1.Container.inject(core_kernel_1.Container.Identifiers.EventDispatcherService)
], Listener.prototype, "events", void 0);
Listener = __decorate([
    core_kernel_1.Container.injectable()
], Listener);
exports.Listener = Listener;
