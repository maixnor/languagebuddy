import dotenv from "dotenv";
import path from 'path';

// Load environment variables first, before importing config
dotenv.config({ path: path.join(__dirname, '../../.env') });

import express from "express";
import serveStatic from "serve-static";
import Redis from 'ioredis';
import "whatsapp-cloud-api-express";
import { readFileSync } from 'fs';
import yaml from 'js-yaml';

import { LanguageBuddyAgent } from './agents/language-buddy-agent';
import { SubscriberService } from './services/subscriber-service';
import { FeedbackService } from './services/feedback-service';
import { StripeService } from './services/stripe-service';
import { WhatsAppService } from './services/whatsapp-service';
import { SchedulerService } from './schedulers/scheduler-service';
import { logger, config, trackEvent, trackMetric } from './config';
import {SystemPromptEntry} from './types';
import {RedisCheckpointSaver} from "./persistence/redis-checkpointer";

// Load system prompts
let systemPrompts: SystemPromptEntry[] = [];
let defaultSystemPrompt: SystemPromptEntry;
let dailySystemPrompt: SystemPromptEntry;
let fallbackSystemPrompt = {
  slug: "default",
  prompt: "You are a helpful language buddy trying your best to match the user's language level but are always pushing the user to be slightly out of the comfort zone.",
  firstUserMessage: "Hi! Please ask me what language I want to learn with you and at what level I am."
};

try {
  const promptsPath = path.join(process.cwd(), 'system_prompts.yml');
  const promptsData = readFileSync(promptsPath, 'utf8');
  systemPrompts = yaml.load(promptsData) as SystemPromptEntry[];
  defaultSystemPrompt = systemPrompts.find(prompt => prompt.slug === 'default') || fallbackSystemPrompt;
  dailySystemPrompt = systemPrompts.find(prompt => prompt.slug === 'daily') || defaultSystemPrompt;
  logger.info(`Loaded ${systemPrompts.length} system prompts from file`);
} catch (error) {
  logger.error({ err: error }, 'Error loading system prompts from file:');
  defaultSystemPrompt = fallbackSystemPrompt;
  dailySystemPrompt = fallbackSystemPrompt;
  systemPrompts = [defaultSystemPrompt];
}

const redisClient = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  tls: {},
});

redisClient.on('connect', () => {
  logger.info('Successfully connected to Redis!');
});

redisClient.on('error', (err: any) => {
  logger.error({ err }, 'Redis connection error:');
});

const subscriberService = SubscriberService.getInstance(redisClient);
const feedbackService = FeedbackService.getInstance(redisClient);

const languageBuddyAgent = new LanguageBuddyAgent(new RedisCheckpointSaver(redisClient));
const schedulerService = SchedulerService.getInstance(subscriberService, languageBuddyAgent, dailySystemPrompt);

const stripeService = StripeService.getInstance();
stripeService.initialize(config.stripe.secretKey!);
const whatsappService = WhatsAppService.getInstance();
whatsappService.initialize(config.whatsapp.token!, config.whatsapp.phoneId!);

export const app = express();
app.use(express.json());

// Legacy initiate endpoint (kept for backward compatibility)
app.post("/initiate", async (req: any, res: any) => {
  const { phone, promptSlug } = req.body;

  if (!phone || !promptSlug) {
    return res.status(400).send("Missing 'phone' or 'promptSlug' in request body.");
  }

  let subscriber = await subscriberService.getSubscriber(phone) ?? await subscriberService.createSubscriber(phone);

  const hasPaid = await stripeService.checkSubscription(phone);
  if (!hasPaid) {
    logger.info({ phone }, "/initiate: User has not paid at Stripe.");
  } else {
    logger.info({ phone }, "/initiate: User has paid. Proceeding with initiation.");
  }

  try {
    const selectedPrompt = subscriberService.getSystemPrompt(subscriber);
    const initialMessage = await languageBuddyAgent.initiateConversation(subscriber, selectedPrompt, '');

    if (initialMessage) {
      await whatsappService.sendMessage(phone, initialMessage);
      res.status(200).send("Conversation initiated successfully with LangGraph.");
    } else {
      res.status(500).send("Failed to initiate conversation.");
    }
  } catch (error) {
    logger.error({ err: error }, "Error in /initiate endpoint");
    res.status(500).send("Internal server error while processing prompts.");
  }
});

// Main webhook endpoint - now uses LangGraph
app.post("/webhook", async (req: any, res: any) => {
  const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];

  if (message?.type === "text") {
    if (message.text.body === 'ping') {
        logger.info("Received ping message, responding with pong.");
        await whatsappService.sendMessage(message.from, "pong");
        return res.sendStatus(200);
    }
    if (message.text.body === '!clear') {
        logger.info("Received !clear command, clearing conversation history.");
        await languageBuddyAgent.clearConversation(message.from);
        await whatsappService.sendMessage(message.from, "Conversation history cleared.");
        return res.sendStatus(200);
    }
    try {
      await handleTextMessage(message);
    }
    catch (error) {
      res.sendStatus(400).send("Unexpected error while processing webhook.");
    }
  }
  res.sendStatus(200);
});

async function handleNewSubscriber(userPhone: string) {
  logger.info({userPhone}, "New user messaging. Checking Stripe status.");
  trackEvent("new_user_detected", {userPhone: userPhone.slice(-4)});

  const subscriber = await subscriberService.getSubscriber(userPhone) || await subscriberService.createSubscriber(userPhone, {});
  const hasPaid = await stripeService.checkSubscription(userPhone);

  if (!hasPaid && false) { // TODO add the payment link sending
    logger.info({userPhone}, "User has not paid. Sending payment link.");
    trackEvent("payment_required", {userPhone: userPhone.slice(-4)});
    await whatsappService.sendMessage(userPhone, "Welcome! To use me as your language buddy please complete your registration here: https://buy.stripe.com/dRmbJ3bYyfeM1pLgPX8AE01 \nI am still in testing!\n\n\nWillkommen! Um mich zu verwenden registriere dich bitte hier: https://buy.stripe.com/dRmbJ3bYyfeM1pLgPX8AE01 \nIch bin noch im Test-Stadium!");
    return;
  }

  const welcomeMessage = await languageBuddyAgent.initiateConversation(subscriber, subscriberService.getSystemPrompt(subscriber), 'Hi. I am new to this service. Please explain to me what you can do for me?');
  await whatsappService.sendMessage(userPhone, welcomeMessage || "Please try again later, my resources are currently limited and I cannot take in new users. I am still in testing!");
  trackEvent("welcome_sent", {userPhone: userPhone.slice(-4)});
  return;
}

const handleTextMessage = async (message: any) => {
  const userPhone = message.from;

  await whatsappService.markMessageAsRead(message.id);

  trackEvent("text_message_received", {
    userPhone: userPhone.slice(-4),
    messageLength: message.text.body.length,
    timestamp: new Date().toISOString()
  });

  try {
    let subscriber = await subscriberService.getSubscriber(userPhone);
    if (!subscriber) {
      await handleNewSubscriber(userPhone);
      return;
    }

    if (!await languageBuddyAgent.currentlyInActiveConversation(userPhone)) {
        logger.error({ userPhone }, "No active conversation found, initiating new conversation");
        const systemPrompt = subscriberService.getSystemPrompt(subscriber);
        await languageBuddyAgent.initiateConversation(subscriber, systemPrompt, message.text.body);
    }

    const startTime = Date.now();

    const response = await languageBuddyAgent.processUserMessage(subscriber!, message.text.body);

    const processingTime = Date.now() - startTime;
    trackMetric("message_processing_time_ms", processingTime, {
      userPhone: userPhone.slice(-4),
      responseLength: response?.length || 0
    });

    if (response && response.trim() !== "") {
      await whatsappService.sendMessage(userPhone, response);
      trackEvent("response_sent", {
        userPhone: userPhone.slice(-4),
        responseLength: response.length,
        processingTimeMs: processingTime
      });
    } else {
      logger.warn({ userPhone }, "Empty response from LangGraph agent");
      trackEvent("empty_response", { userPhone: userPhone.slice(-4) });
    }

  } catch (error) {
    logger.error({ err: error, userPhone }, `Error processing message through LangGraph`);
    trackEvent("message_processing_error", {
      userPhone: userPhone.slice(-4),
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });
    await whatsappService.sendMessage(userPhone, "Hey, I'm currently suffering from bugs. The exterminator has been called already!");
  }
}
// New endpoints for LangGraph features

// Feedback analytics endpoint
app.get("/analytics/feedback", async (req: any, res: any) => {
  try {
    const analytics = await feedbackService.getFeedbackAnalytics();
    res.json(analytics);
  } catch (error) {
    logger.error({ err: error }, "Error getting feedback analytics");
    res.status(500).json({ error: "Failed to get feedback analytics" });
  }
});

// Manual scheduler triggers (for testing)
app.post("/admin/trigger-daily-messages", async (req: any, res: any) => {
  try {
    await schedulerService.triggerDailyMessages();
    res.json({ message: "Daily messages triggered successfully" });
  } catch (error) {
    logger.error({ err: error }, "Error triggering daily messages");
    res.status(500).json({ error: "Failed to trigger daily messages" });
  }
});

app.post("/admin/trigger-nightly-digests", async (req: any, res: any) => {
  try {
    await schedulerService.triggerNightlyDigests();
    res.json({ message: "Nightly digests triggered successfully" });
  } catch (error) {
    logger.error({ err: error }, "Error triggering nightly digests");
    res.status(500).json({ error: "Failed to trigger nightly digests" });
  }
});

app.post("/admin/trigger-history-cleanup", async (req: any, res: any) => {
  try {
    await schedulerService.triggerHistoryCleanup();
    res.json({ message: "History cleanup triggered successfully" });
  } catch (error) {
    logger.error({ err: error }, "Error triggering history cleanup");
    res.status(500).json({ error: "Failed to trigger history cleanup" });
  }
});

// Service status endpoint
app.get("/admin/services/status", (req: any, res: any) => {
  res.json({
    redis: redisClient.status,
    whatsapp: whatsappService.getStatus(),
    stripe: {
      initialized: true // StripeService doesn't expose detailed status yet
    },
    langGraph: "operational",
    schedulers: "running"
  });
});

// Subscriber info endpoint
app.get("/subscriber/:phone", async (req: any, res: any) => {
  try {
    const subscriber = await subscriberService.getSubscriber(req.params.phone);
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
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    services: {
      redis: redisClient.status,
      whatsapp: whatsappService.isInitialized(),
      langGraph: "operational",
      schedulers: "running"
    }
  });
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

app.get("/", (req: any, res: any) => {
  logger.info("/");
  res.send("Language Buddy Backend - LangGraph Edition");
});

// Set up static file serving for HTML files
app.use('/static', serveStatic(process.cwd() + "/static"));

const port = config.server.port;
app.listen(port, () => {
  logger.info(`🚀 Language Buddy Backend with LangGraph running on port ${port}`);
  logger.info("🔄 Schedulers started for daily messages and nightly digests");
  logger.info("📊 Analytics and admin endpoints available");
  logger.info(`📱 WhatsApp service: ${whatsappService.isInitialized() ? 'initialized' : 'not initialized'}`);
});
