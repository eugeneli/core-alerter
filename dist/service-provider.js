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
exports.ServiceProvider = void 0;
const core_kernel_1 = require("@arkecosystem/core-kernel");
const listener_1 = require("./listener");
class ServiceProvider extends core_kernel_1.Providers.ServiceProvider {
    constructor() {
        super(...arguments);
        this.listenerSymbol = Symbol.for("EventAlerter<Listener>");
    }
    register() {
        return __awaiter(this, void 0, void 0, function* () {
            this.app.bind(this.listenerSymbol).to(listener_1.Listener).inSingletonScope();
            this.logger.info(`[Plugin] Event Alerter registered on Core ${this.app.version()}`);
        });
    }
    bootWhen() {
        return __awaiter(this, void 0, void 0, function* () {
            return !!this.config().get("enabled");
        });
    }
    boot() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.app.get(this.listenerSymbol).boot();
            this.logger.info(`[Plugin] Event Alerter booted!`);
        });
    }
    dispose() {
        return __awaiter(this, void 0, void 0, function* () {
            this.logger.info(`[Plugin] Event Alerter shutting down...`);
        });
    }
}
__decorate([
    core_kernel_1.Container.inject(core_kernel_1.Container.Identifiers.LogService)
], ServiceProvider.prototype, "logger", void 0);
exports.ServiceProvider = ServiceProvider;
