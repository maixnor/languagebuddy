import express from "express";
import serveStatic from "serve-static";
import { logger, config } from './config';
import { ServiceContainer } from './services/service-container';
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
    this.app.use('/static', serveStatic(process.cwd() + "/static"));
  }

  getApp(): express.Application {
    return this.app;
  }

  getServiceContainer(): ServiceContainer {
    return this.serviceContainer;
  }

  start(port: number): void {
    this.app.listen(port, () => {
      logger.info(`🚀 Language Buddy Backend with LangGraph running on port ${port}`);
      logger.info("🔄 Schedulers started for daily messages and nightly digests");
      logger.info("📊 Analytics and admin endpoints available");
      logger.info(`📱 WhatsApp service: ${this.serviceContainer.whatsappService.isInitialized() ? 'initialized' : 'not initialized'}`);
    });
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
