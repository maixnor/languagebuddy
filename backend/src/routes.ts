import express from "express";
import { ServiceContainer } from './core/container';
import { MessagingService } from './features/messaging/messaging.service';
import { StripeWebhookService } from './features/subscription/subscription-webhook.service';
import { logger, config } from './core/config';
import { getCommitHash, getPackageVersion } from './core/config/config.version-info';
import { metricsRegistry } from './core/observability/metrics';

export function setupRoutes(app: express.Application, services: ServiceContainer): void {
  const messagingService = new MessagingService(services);

  // Prometheus Metrics Endpoint
  app.get("/metrics", async (req: any, res: any) => {
    try {
      res.set('Content-Type', metricsRegistry.contentType);
      res.end(await metricsRegistry.metrics());
    } catch (err) {
      res.status(500).end(err);
    }
  });

  // Legacy initiate endpoint (kept for backward compatibility)
  app.post("/initiate", async (req: any, res: any) => {
    try {
      await messagingService.handleInitiateRequest(req.body, res);
    } catch (error) {
      logger.error({ err: error }, "Error in /initiate endpoint");
      res.status(500).send("Internal server error while processing prompts.");
    }
  });

  // Main webhook endpoint (WhatsApp)
  app.post("/webhook", async (req: any, res: any) => {
    try {
      await messagingService.handleWebhookMessage(req.body, res);
    } catch (error) {
      logger.error({ err: error }, "Error in /webhook endpoint");
      res.status(500).send("Internal server error while processing webhook.");
    }
  });

  // Stripe Webhook Endpoint
  app.post("/stripe-webhook", express.raw({ type: 'application/json' }), async (req: any, res: any) => {
    const signature = req.headers['stripe-signature'];
    try {
      await services.stripeWebhookService.handleWebhookEvent(signature, req.rawBody);
      res.sendStatus(200);
    } catch (error) {
      logger.error({ err: error }, "Error in /stripe-webhook endpoint");
      res.status(400).send(`Webhook Error: ${error.message}`);
    }
  });

  // Feedback analytics endpoint
  // SECURITY: Deactivated due to unauthenticated access vulnerability. See tasks/security_vulnerabilities_remediation.md
  /*
  app.get("/analytics/feedback", async (req: any, res: any) => {
    try {
      const analytics = await services.feedbackService.getFeedbackAnalytics();
      res.json(analytics);
    } catch (error) {
      logger.error({ err: error }, "Error getting feedback analytics");
      res.status(500).json({ error: "Failed to get feedback analytics" });
    }
  });
  */

  // Subscriber info endpoint
  // SECURITY: Deactivated due to unauthenticated PII leak. See tasks/security_vulnerabilities_remediation.md
  /*
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
  */

  // Health check endpoint
  app.get("/health", (req: any, res: any) => {
    const health = {
      timestamp: new Date().toISOString(),
      version: {
        package: getPackageVersion(),
        commit: getCommitHash()
      },
      services: {

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

  // Telegram webhook endpoint
  app.post("/telegram/webhook", async (req: any, res: any) => {
    try {
      await messagingService.handleTelegramWebhookMessage(req.body, res);
    } catch (error) {
      logger.error({ err: error }, "Error in /telegram/webhook endpoint");
      res.status(500).send("Internal server error while processing Telegram webhook.");
    }
  });

  // Telegram webhook verification (Not strictly needed for Telegram, but good to have a placeholder)
  app.get("/telegram/webhook", (req: any, res: any) => {
    logger.info("Telegram webhook verification request received. No specific action needed as Telegram uses setWebhook API.");
    res.sendStatus(200);
  });

  // Root endpoint
  app.get("/", (req: any, res: any) => {
    logger.info("/");
    res.send("why are you even here?");
  });
}
