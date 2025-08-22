import dotenv from "dotenv";
import path from 'path';

// Load environment variables first, before importing config
dotenv.config({ path: path.join(process.cwd(), '.env') });

import express from "express";
import serveStatic from "serve-static";
import Redis from 'ioredis';
import "whatsapp-cloud-api-express";

import { LanguageBuddyAgent } from './agents/language-buddy-agent';
import { SubscriberService } from './services/subscriber-service';
import { OnboardingService } from './services/onboarding-service';
import { FeedbackService } from './services/feedback-service';
import { StripeService } from './services/stripe-service';
import { WhatsAppService } from './services/whatsapp-service';
import { SchedulerService } from './schedulers/scheduler-service';
import { logger, config, trackEvent, trackMetric } from './config';
import { Subscriber, WebhookMessage } from './types';
import { RedisCheckpointSaver } from "./persistence/redis-checkpointer";
import { ChatOpenAI } from "@langchain/openai";
import { WhatsappDeduplicationService } from "./services/whatsapp-deduplication-service";
import { handleUserCommand } from './util/user-commands';
import { getNextMissingField, getPromptForField } from './util/info-gathering';
import { generateOnboardingSystemPrompt, generateRegularSystemPrompt } from './util/system-prompts';
import { getFirstLearningLanguage } from "./util/subscriber-utils";
import { initializeTools } from "./tools";

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

// Initialize tools with Redis client
initializeTools(redisClient);

const subscriberService = SubscriberService.getInstance(redisClient);
const onboardingService = OnboardingService.getInstance(redisClient);
const feedbackService = FeedbackService.getInstance(redisClient);
const whatsappDeduplicationService = WhatsappDeduplicationService.getInstance(redisClient);

export const languageBuddyAgent = new LanguageBuddyAgent(new RedisCheckpointSaver(redisClient), llm);
const schedulerService = SchedulerService.getInstance(subscriberService, languageBuddyAgent);
schedulerService.startSchedulers();

const stripeService = StripeService.getInstance();
stripeService.initialize(config.stripe.secretKey!);
export const whatsappService = WhatsAppService.getInstance();
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

  // TODO TESTING NEEDS TO BE DONE FOR SCHEDULING AND DYNAMIC INFORMATION GATHERING

  try {
    if (subscriberService.shouldThrottle(subscriber)) {
      const canStart = await subscriberService.canStartConversationToday(phone);
      if (!canStart) {
        const paymentLink = await stripeService.getPaymentLink(phone);
        await whatsappService.sendMessage(phone, `⏳ You have reached your daily limit. Subscribe for unlimited conversations: ${paymentLink}`);
        return res.status(200).send("Daily conversation limit reached. Please subscribe for unlimited access.");
      }
    }

    const selectedPrompt = subscriberService.getDailySystemPrompt(subscriber);
    await languageBuddyAgent.clearConversation(subscriber.connections.phone);
    const initialMessage = await languageBuddyAgent.initiateConversation(subscriber, selectedPrompt, '');

    if (initialMessage) {
      await subscriberService.incrementConversationCount(phone);
      await whatsappService.sendMessage(phone, initialMessage);
      if (subscriberService.shouldPromptForSubscription(subscriber)) {
        const paymentLink = await stripeService.getPaymentLink(phone);
        const paymentMsg = `Your trial period has ended. To continue unlimited conversations, please subscribe here: ${paymentLink}`;
        await whatsappService.sendMessage(phone, paymentMsg);
      }
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
  const message: WebhookMessage = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];
  // use test somewhere in here
  // const test = message.from.startsWith('69');

  if (message && message.id && await whatsappDeduplicationService.isDuplicateMessage(message.id)) {
    logger.trace({ messageId: message.id }, 'Duplicate webhook event ignored.');
    return res.sendStatus(200);
  }

  if (!message || !message.from) {
    return res.sendStatus(200);
  }

  if (message?.type !== "text") {
    logger.info(message.type, "unsupported type of message")
    await whatsappService.sendMessage(message.from, "I currently only support text messages. Please send a text message to continue.");
    return;
  }

  let existingSubscriber = await subscriberService.getSubscriber(message.from);
  const isInOnboarding = await onboardingService.isInOnboarding(message.from);

  // Handle new users and onboarding flow
  if (!existingSubscriber && !isInOnboarding) {
    // Start onboarding for completely new users
    await onboardingService.startOnboarding(message.from);
    const systemPrompt = generateOnboardingSystemPrompt();
    const welcomeMessage = await languageBuddyAgent.initiateConversation(
      { connections: { phone: message.from } } as Subscriber,
      systemPrompt,
      message.text!.body
    );
    await whatsappService.sendMessage(message.from, welcomeMessage);
    return res.sendStatus(200);
  }

  // Handle users still in onboarding
  if (!existingSubscriber && isInOnboarding) {
    const response = await languageBuddyAgent.processUserMessage(
      { connections: { phone: message.from } } as Subscriber,
      message.text!.body
    );
    await whatsappService.sendMessage(message.from, response);
    return res.sendStatus(200);
  }

  if (existingSubscriber && isInOnboarding) {
    await onboardingService.completeOnboarding(message.from);
    await languageBuddyAgent.clearConversation(existingSubscriber.connections.phone);
  }

  const subscriber = existingSubscriber ?? await subscriberService.getSubscriber(message.from);
  if (!subscriber) {
    logger.error({ phone: message.from }, "Subscriber should exist at this point but doesn't");
    return res.sendStatus(500);
  }

  if (await handleUserCommand(subscriber, message.text!.body, whatsappService, languageBuddyAgent) !== 'nothing') {
    await whatsappService.markMessageAsRead(message.id);
    return res.sendStatus(200);
  }
  try {
    // TODO add throttling to non-paying users here, even before sending requests to GPT
    if (await whatsappDeduplicationService.isThrottled(message.from)) {
      logger.info({ phone: message.from }, 'User is throttled, message ignored.');
      await whatsappService.sendMessage(message.from, "You are sending messages too quickly. Please wait a few seconds between messages.");
      return res.sendStatus(200);
    }

    // For existing subscribers, use regular conversation flow
    let missingField = getNextMissingField(subscriber)
    if (missingField != null) {
      if (subscriber.profile.speakingLanguages[0] != null) {
        const response = await languageBuddyAgent.oneShotMessage(
          getPromptForField(missingField),
          subscriber.profile.speakingLanguages[0].languageName || "english",
          subscriber.connections.phone
        );
        await whatsappService.sendMessage(message.from, response);
        return res.sendStatus(200);
      } else {
        // not even the speakingLanguage is set
        const response = await languageBuddyAgent.oneShotMessage(
          getPromptForField("speakinglanguages"),
          "english",
          subscriber.connections.phone
        );
        await whatsappService.sendMessage(message.from, response);
        return res.sendStatus(200);
      }
    }

    await handleTextMessage(message);
  }
  catch (error) {
    whatsappService.sendMessage(message.from, "An unexpected error occurred while processing your message. Please try again later.");
    logger.error({ err: error, message, health: getHealth() }, "Error processing webhook message");
    res.sendStatus(400);
    return;
  }
  //res.sendStatus(200);
});

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
      logger.error({ userPhone }, "Subscriber should exist at this point (handleTextMessage)");
      return;
    }

    const startTime = Date.now();
    let response: string;
    if (!await languageBuddyAgent.currentlyInActiveConversation(userPhone)) {
      logger.info({ userPhone }, "No active conversation found, initiating new conversation");
      const systemPrompt = generateRegularSystemPrompt(subscriber, getFirstLearningLanguage(subscriber)); // TODO alternate every few days
      response = await languageBuddyAgent.initiateConversation(subscriber, systemPrompt, message.text.body);
    } else {
      response = await languageBuddyAgent.processUserMessage(subscriber, message.text.body);
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

function getHealth() {
  return {
    timestamp: new Date().toISOString(),
    services: {
      redis: redisClient.status,
      whatsapp: whatsappService.isInitialized() ? "running" : "failed", 
      openai: { model: llm.model, temperature: llm.temperature },
      dailyMessages: config.features.dailyMessages.enabled ? "enabled" : "disabled"
    }
  }
}

// Health check endpoint
app.get("/health", (req: any, res: any) => {
  res.json(getHealth());
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
