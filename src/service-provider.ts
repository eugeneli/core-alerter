import { Container, Contracts, Providers } from "@arkecosystem/core-kernel";

import { Listener } from "./listener";

export class ServiceProvider extends Providers.ServiceProvider {
    @Container.inject(Container.Identifiers.LogService)
    private readonly logger!: Contracts.Kernel.Logger;

    private listenerSymbol = Symbol.for("EventAlerter<Listener>");

    public async register(): Promise<void> {
        this.app.bind<Listener>(this.listenerSymbol).to(Listener).inSingletonScope();

        this.logger.info(`[Plugin] Event Alerter registered on Core ${this.app.version()}`);
    }

    public async bootWhen(): Promise<boolean> {
        return !!this.config().get("enabled");
    }

    public async boot(): Promise<void> {
        await this.app.get<Listener>(this.listenerSymbol).boot();
        
        this.logger.info(`[Plugin] Event Alerter booted!`);
    }

    public async dispose(): Promise<void> {
        this.logger.info(`[Plugin] Event Alerter shutting down...`);
    }
}