import dotenv from "dotenv";
import path from 'path';

// Load environment variables first, before importing config
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Initialize tracing BEFORE any other imports (critical for auto-instrumentation)
import { initializeTracing } from './observability/tracing';
initializeTracing();

import express from "express";
import serveStatic from "serve-static";
import "whatsapp-cloud-api-express";

import { ServiceContainer } from './services/service-container';
import { setupRoutes } from './routes';
import { logger, config } from './config';
import { loadVersionInfo } from './util/version-info';

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
    app.listen(port, () => {});
    
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
