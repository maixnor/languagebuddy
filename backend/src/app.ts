import express from "express";
import { logger, config } from './core/config';
import { ServiceContainer } from './core/container';
import { setupRoutes } from './routes';

export class Application {
  private app: express.Application;
  private serviceContainer: ServiceContainer;

  constructor() {
    this.app = express();
    this.serviceContainer = new ServiceContainer();
  }

  async initialize(): Promise<void> {
    // Initialize services
    await this.serviceContainer.initialize();

    // Setup middleware
    this.app.use(express.json());

    // Setup routes
    setupRoutes(this.app, this.serviceContainer);
  }

  getApp(): express.Application {
    return this.app;
  }

  getServiceContainer(): ServiceContainer {
    return this.serviceContainer;
  }

  start(port: number): void {
    this.app.listen(port, () => {});
  }

  getHealth() {
    return {
      timestamp: new Date().toISOString(),
      services: {
        whatsapp: this.serviceContainer.whatsappService.isInitialized() ? "enabled" : "failed",
        telegram: this.serviceContainer.telegramService ? "enabled" : "failed",
        openai: { 
          model: this.serviceContainer.llm.model, 
          temperature: this.serviceContainer.llm.temperature 
        },
        dailyMessages: config.features.dailyMessages.enabled ? "enabled" : "disabled"
      }
    };
  }
}
