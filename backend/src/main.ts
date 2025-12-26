import dotenv from "dotenv";
import path from 'path';

// Load environment variables first
dotenv.config({ path: path.join(process.cwd(), '.env') });


import { logger } from './core/config';

async function main() {
  try {
    // Dynamically import modules AFTER tracing is initialized to ensure auto-instrumentation works
    const express = (await import("express")).default;
    await import("whatsapp-cloud-api-express");

    const { ServiceContainer } = await import('./core/container');
    const { setupRoutes } = await import('./routes');
    const { config } = await import('./core/config');
    const { loadVersionInfo } = await import('./core/config/config.version-info');
    const { MetricsService } = await import('./features/metrics/metrics.service');

    // Load version info on startup
    loadVersionInfo();
    
    // Create Express app
    const app = express();
    app.use(express.json({
      verify: (req: any, res: any, buf: Buffer) => {
        req.rawBody = buf;
      }
    }));
    
    // Initialize services
    const services = new ServiceContainer();
    await services.initialize();

    // Start Metrics Scheduler
    const metricsService = MetricsService.getInstance(services);
    metricsService.startScheduler(60000); // Poll every minute
    
    // Setup routes
    setupRoutes(app, services);
    
    // Start server
    const port = Number(config.server.port) || 3000;
    const server = app.listen(port, () => {
      logger.info(`Server running on port ${port}`);
    });

    const gracefulShutdown = (signal: string) => {
      logger.info(`${signal} signal received: closing HTTP server`);
      metricsService.stopScheduler(); // Stop metrics polling
      server.close(async () => {
        logger.info('HTTP server closed');
        
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
      metricsService,
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
