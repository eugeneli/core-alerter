"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceProvider = void 0;
const core_kernel_1 = require("@arkecosystem/core-kernel");
const listener_1 = require("./listener");
class ServiceProvider extends core_kernel_1.Providers.ServiceProvider {
    constructor() {
        super(...arguments);
        this.listenerSymbol = Symbol.for("EventAlerter<Listener>");
    }
    async register() {
        this.app.bind(this.listenerSymbol).to(listener_1.Listener).inSingletonScope();
        this.logger.info(`[Plugin] Event Alerter registered on Core ${this.app.version()}`);
    }
    async bootWhen() {
        return !!this.config().get("enabled");
    }
    async boot() {
        await this.app.get(this.listenerSymbol).boot();
        this.logger.info(`[Plugin] Event Alerter booted!`);
    }
    async dispose() {
        this.logger.info(`[Plugin] Event Alerter shutting down...`);
    }
}
__decorate([
    core_kernel_1.Container.inject(core_kernel_1.Container.Identifiers.LogService)
], ServiceProvider.prototype, "logger", void 0);
exports.ServiceProvider = ServiceProvider;
