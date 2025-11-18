import express from "express";
import { ServiceContainer } from './services/service-container';
import { WebhookService } from './services/webhook-service';
import { logger, config } from './config';
import { getCommitHash, getPackageVersion } from './util/version-info';

export function setupRoutes(app: express.Application, services: ServiceContainer): void {
  const webhookService = new WebhookService(services);

  // Legacy initiate endpoint (kept for backward compatibility)
  app.post("/initiate", async (req: any, res: any) => {
    try {
      await webhookService.handleInitiateRequest(req.body, res);
    } catch (error) {
      logger.error({ err: error }, "Error in /initiate endpoint");
      res.status(500).send("Internal server error while processing prompts.");
    }
  });

  // Main webhook endpoint
  app.post("/webhook", async (req: any, res: any) => {
    try {
      await webhookService.handleWebhookMessage(req.body, res);
    } catch (error) {
      logger.error({ err: error }, "Error in /webhook endpoint");
      res.status(500).send("Internal server error while processing webhook.");
    }
  });

  // Feedback analytics endpoint
  app.get("/analytics/feedback", async (req: any, res: any) => {
    try {
      const analytics = await services.feedbackService.getFeedbackAnalytics();
      res.json(analytics);
    } catch (error) {
      logger.error({ err: error }, "Error getting feedback analytics");
      res.status(500).json({ error: "Failed to get feedback analytics" });
    }
  });

  // Subscriber info endpoint
  app.get("/subscriber/:phone", async (req: any, res: any) => {
    try {
      const subscriber = await services.subscriberService.getSubscriber(req.params.phone);
      if (!subscriber) {
        res.status(404).json({error: "Subscriber not found"});
      } else {
        // Remove sensitive information before sending
        const {...safeSubscriber} = subscriber;
        res.json(safeSubscriber);
      }
    } catch (error) {
      logger.error({ err: error, phone: req.params.phone }, "Error getting subscriber info");
      res.status(500).json({ error: "Failed to get subscriber info" });
    }
  });

  // Health check endpoint
  app.get("/health", (req: any, res: any) => {
    const health = {
      timestamp: new Date().toISOString(),
      version: {
        package: getPackageVersion(),
        commit: getCommitHash()
      },
      services: {
        redis: services.redisClient.status,
        whatsapp: services.whatsappService.isInitialized() ? "enabled" : "failed",
        openai: { 
          model: services.llm.model, 
          temperature: services.llm.temperature 
        },
      }
    };
    res.json(health);
  });

  // WhatsApp webhook verification
  app.get("/webhook", (req: any, res: any) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
      res.status(200).send(challenge);
      logger.info("Webhook verified successfully!");
    } else {
      res.sendStatus(403);
    }
  });

  // Root endpoint - serve frontend
  app.get("/", (req: any, res: any) => {
    logger.info("/");
    res.sendFile(process.cwd() + "/static/index.html", (err) => {
      if (err) {
        logger.warn({ err }, "Could not serve frontend index.html, falling back to text response");
        res.send("Language Buddy Backend - Powered by LangGraph");
      }
    });
  });

  // Serve frontend routes (privacy, impressum, etc.)
  app.get(["/privacy", "/impressum"], (req: any, res: any) => {
    const page = req.path.substring(1); // Remove leading slash
    res.sendFile(process.cwd() + `/static/${page}.html`, (err) => {
      if (err) {
        logger.warn({ err, page }, `Could not serve ${page}.html`);
        res.status(404).send("Page not found");
      }
    });
  });
}
