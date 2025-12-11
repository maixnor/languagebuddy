import express from "express";
import serveStatic from "serve-static";
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

    // Set up static file serving for HTML files

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
        redis: this.serviceContainer.redisClient.status,
        whatsapp: this.serviceContainer.whatsappService.isInitialized() ? "enabled" : "failed",
        openai: { 
          model: this.serviceContainer.llm.model, 
          temperature: this.serviceContainer.llm.temperature 
        },
        dailyMessages: config.features.dailyMessages.enabled ? "enabled" : "disabled"
      }
    };
  }
}
