import dotenv from "dotenv";
import path from 'path';

// Load environment variables first, before importing config
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Initialize tracing BEFORE any other imports (critical for auto-instrumentation)
import { initializeTracing } from './core/observability/tracing';
initializeTracing();

import express from "express";
import serveStatic from "serve-static";
import "whatsapp-cloud-api-express";

import { ServiceContainer } from './core/container';
import { setupRoutes } from './routes';
import { logger, config } from './core/config';
import { loadVersionInfo } from './core/config/config.version-info';

async function main() {
  try {
    // Load version info on startup
    loadVersionInfo();
    
    // Create Express app
    const app = express();
    app.use(express.json());
    
    // Initialize services
    const services = new ServiceContainer();
    await services.initialize();
    
    // Setup routes
    setupRoutes(app, services);
    
    // Set up static file serving for HTML files
    app.use('/static', serveStatic(process.cwd() + "/static"));
    
    // Start server
    const port = Number(config.server.port) || 3000;
    const server = app.listen(port, () => {
      logger.info(`Server running on port ${port}`);
    });

    const gracefulShutdown = (signal: string) => {
      logger.info(`${signal} signal received: closing HTTP server`);
      server.close(async () => {
        logger.info('HTTP server closed');
        
        try {
          if (services.redisClient) {
            logger.info('Closing Redis connection...');
            await services.redisClient.quit();
            logger.info('Redis connection closed');
          }
        } catch (err) {
          logger.error({ err }, 'Error closing Redis connection');
        }

        process.exit(0);
      });

      // Force close after 10 seconds
      setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    return {
      languageBuddyAgent: services.languageBuddyAgent,
      whatsappService: services.whatsappService,
      app: app
    };
    
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application
main().then((exports) => {
  // Make services available as module exports if needed
  if (exports) {
    module.exports = exports;
  }
}).catch(console.error);
