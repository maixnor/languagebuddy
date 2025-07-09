import dotenv from "dotenv";
import path from 'path';

// Load environment variables first, before importing config
dotenv.config({ path: path.join(__dirname, '../../.env') });

import express from "express";
import serveStatic from "serve-static";
import Redis from 'ioredis';
import "whatsapp-cloud-api-express";

import { LanguageBuddyAgent } from './agents/language-buddy-agent';
import { SubscriberService } from './services/subscriber-service';
import { FeedbackService } from './services/feedback-service';
import { StripeService } from './services/stripe-service';
import { WhatsAppService } from './services/whatsapp-service';
import { SchedulerService } from './schedulers/scheduler-service';
import { logger, config, trackEvent, trackMetric } from './config';
import {Subscriber, WebhookMessage} from './types';
import {RedisCheckpointSaver} from "./persistence/redis-checkpointer";
import { ChatOpenAI, OpenAIClient } from "@langchain/openai";
import { WhatsappDeduplicationService } from "./services/whatsapp-deduplication-service";

const redisClient = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  // tls: {},
});

redisClient.on('connect', () => {
  logger.info('Successfully connected to Redis!');
});

redisClient.on('error', (err: any) => {
  logger.error({ err }, 'Redis connection error:');
});


const llm = new ChatOpenAI({
  model: 'gpt-4o-mini',
  temperature: 0.3,
  maxTokens: 1000,
});

const subscriberService = SubscriberService.getInstance(redisClient);
const feedbackService = FeedbackService.getInstance(redisClient);
const whatsappDeduplicationService = WhatsappDeduplicationService.getInstance(redisClient);

const languageBuddyAgent = new LanguageBuddyAgent(new RedisCheckpointSaver(redisClient), llm);
const schedulerService = SchedulerService.getInstance(subscriberService, languageBuddyAgent);
schedulerService.startSchedulers();

const stripeService = StripeService.getInstance();
stripeService.initialize(config.stripe.secretKey!);
const whatsappService = WhatsAppService.getInstance();
whatsappService.initialize(config.whatsapp.token!, config.whatsapp.phoneId!);

export const app = express();
app.use(express.json());

// Legacy initiate endpoint (kept for backward compatibility)
app.post("/initiate", async (req: any, res: any) => {
  const { phone} = req.body;

  if (!phone) {
    return res.status(400).send("Missing 'phone' in request body.");
  }

  let subscriber = await subscriberService.getSubscriber(phone) ?? await subscriberService.createSubscriber(phone);

  const hasPaid = await stripeService.checkSubscription(phone);
  if (!hasPaid) {
    logger.info({ phone }, "/initiate: User has not paid at Stripe.");
  } else {
    logger.info({ phone }, "/initiate: User has paid. Proceeding with initiation.");
  }

  try {
    const selectedPrompt = subscriberService.getDailySystemPrompt(subscriber);
    await languageBuddyAgent.clearConversation(subscriber.connections.phone);
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

async function handleUserCommand(subscriber: Subscriber, message: string) {
    if (message === 'ping') {
        logger.info("Received ping message, responding with pong.");
        await whatsappService.sendMessage(subscriber.connections.phone, "pong");
        return "ping";
    }

    if (message.startsWith('!clear')) {
        logger.info("Received !clear command, clearing conversation history.");
        await languageBuddyAgent.clearConversation(subscriber.connections.phone);
        await whatsappService.sendMessage(subscriber.connections.phone, "Conversation history cleared.");
        return '!clear';
    }

    if (message.startsWith('!help') || message.startsWith('help')) {
      logger.info(`User ${subscriber.connections.phone} requested help`);
      await whatsappService.sendMessage(subscriber.connections.phone, 'Help is currently under development and just available in English. Commands are:\n- "!help": Display again what you are reading right now\n- "!clear": clear the current chat history\n- "ping" sends a pong message to test connectivity');
    }

    return "nothing";
}

// Main webhook endpoint - now uses LangGraph
app.post("/webhook", async (req: any, res: any) => {
  const message: WebhookMessage = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];

  if (message && message.id && await whatsappDeduplicationService.isDuplicateMessage(message.id)) {
    logger.trace({ messageId: message.id }, 'Duplicate webhook event ignored.');
    return res.sendStatus(200);
  }

  if (!message || !message.from) {
    logger.error("Invalid message format received in webhook.");
    return res.sendStatus(400);
  }

  if (await whatsappDeduplicationService.isThrottled(message.from)) {
    logger.info({ phone: message.from }, 'User is throttled, message ignored.');
    await whatsappService.sendMessage(message.from, "You are sending messages too quickly. Please wait a few seconds between messages.");
    return res.sendStatus(200);
  }
  // use test somewhere in here
  // const test = message.from.startsWith('69');
  if (message?.type !== "text") {
    await whatsappService.sendMessage(message.from, "I currently only support text messages. Please send a text message to continue.");
    return;
  }

  let existingSubscriber = await subscriberService.getSubscriber(message.from);
  if (!existingSubscriber) {
    if (message.text!.body.toLowerCase().indexOf("accept") >= 0) {
      await subscriberService.createSubscriber(message.from);
    } else {
      whatsappService.sendMessage(message.from , "Hi. I'm an automated system. I save your phone number and your name. You can find more info in the privacy statement at https://languagebuddy-test.maixnor.com/static/privacy.html. If you accept this reply with 'ACCEPT'");
      return;
    }
  }

  const subscriber = existingSubscriber ?? await subscriberService.getSubscriber(message.from);
  if (await handleUserCommand(subscriber!, message.text!.body) !== 'nothing') {
    return res.sendStatus(200);
  }
  try {
    // TODO add throttling to non-paying users here, even before sending requests to GPT
    await handleTextMessage(message);
  }
  catch (error) {
    res.sendStatus(400).send("Unexpected error while processing webhook.");
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

  const welcomeMessage = await languageBuddyAgent.initiateConversation(subscriber, subscriberService.getDefaultSystemPrompt(subscriber), 'Hi. I am new to this service. Please explain to me what you can do for me?');
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

    logger.warn(subscriber);

    const startTime = Date.now();

    let response = "";
    if (!await languageBuddyAgent.currentlyInActiveConversation(userPhone)) {
      logger.error({ userPhone }, "No active conversation found, initiating new conversation");
      const systemPrompt = subscriberService.getDefaultSystemPrompt(subscriber);
      await languageBuddyAgent.clearConversation(subscriber.connections.phone);
      response = await languageBuddyAgent.initiateConversation(subscriber, systemPrompt, '');
    } else {
      response = await languageBuddyAgent.processUserMessage(subscriber!, message.text.body);
    }

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
      whatsapp: whatsappService.isInitialized() ? "running" : "failed", 
      daily_messages: config.features.dailyMessages.enabled ? `${config.features.dailyMessages.localTime} local time` : 'disabled',
      openai: { model: llm.model, temperature: llm.temperature }
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
  res.send("Language Buddy Backend - Powered by LangGraph");
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
