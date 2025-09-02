import { ServiceContainer } from './service-container';
import { logger, trackEvent, trackMetric, config } from '../config';
import { WebhookMessage, Subscriber } from '../types';
import { handleUserCommand } from '../util/user-commands';
import { getNextMissingField, getPromptForField } from '../util/info-gathering';
import { generateOnboardingSystemPrompt, generateRegularSystemPrompt } from '../util/system-prompts';
import { getFirstLearningLanguage } from "../util/subscriber-utils";

export class WebhookService {
  constructor(private services: ServiceContainer) {}

  async handleInitiateRequest(body: any, res: any): Promise<void> {
    const { phone } = body;

    if (!phone) {
      res.status(400).send("Missing 'phone' in request body.");
      return;
    }

    let subscriber = await this.services.subscriberService.getSubscriber(phone) ?? 
                    await this.services.subscriberService.createSubscriber(phone);

    const hasPaid = await this.services.stripeService.checkSubscription(phone);
    if (!hasPaid) {
      logger.info({ phone }, "/initiate: User has not paid at Stripe.");
    } else {
      logger.info({ phone }, "/initiate: User has paid. Proceeding with initiation.");
    }

    // Check throttling and subscription limits
    if (this.services.subscriberService.shouldThrottle(subscriber)) {
      const canStart = await this.services.subscriberService.canStartConversationToday(phone);
      if (!canStart) {
        const paymentLink = await this.services.stripeService.getPaymentLink(phone);
        await this.services.whatsappService.sendMessage(
          phone, 
          `⏳ You have reached your daily limit. Subscribe for unlimited conversations: ${paymentLink}`
        );
        res.status(200).send("Daily conversation limit reached. Please subscribe for unlimited access.");
        return;
      }
    }

    // Start conversation
    const selectedPrompt = this.services.subscriberService.getDailySystemPrompt(subscriber);
    await this.services.languageBuddyAgent.clearConversation(subscriber.connections.phone);
    const initialMessage = await this.services.languageBuddyAgent.initiateConversation(
      subscriber, 
      selectedPrompt, 
      ''
    );

    if (initialMessage) {
      await this.services.subscriberService.incrementConversationCount(phone);
      await this.services.whatsappService.sendMessage(phone, initialMessage);
      
      if (this.services.subscriberService.shouldPromptForSubscription(subscriber)) {
        const paymentLink = await this.services.stripeService.getPaymentLink(phone);
        const paymentMsg = `Your trial period has ended. To continue unlimited conversations, please subscribe here: ${paymentLink}`;
        await this.services.whatsappService.sendMessage(phone, paymentMsg);
      }
      
      res.status(200).send("Conversation initiated successfully with LangGraph.");
    } else {
      res.status(500).send("Failed to initiate conversation.");
    }
  }

  async handleWebhookMessage(body: any, res: any): Promise<void> {
    const message: WebhookMessage = body.entry?.[0]?.changes[0]?.value?.messages?.[0];

    // Check for duplicate messages
    if (message && message.id && await this.services.whatsappDeduplicationService.isDuplicateMessage(message.id)) {
      logger.trace({ messageId: message.id }, 'Duplicate webhook event ignored.');
      res.sendStatus(200);
      return;
    }

    if (!message || !message.from) {
      res.sendStatus(200);
      return;
    }

    // Only handle text messages
    if (message?.type !== "text") {
      logger.info(message.type, "unsupported type of message");
      await this.services.whatsappService.sendMessage(
        message.from, 
        "I currently only support text messages. Please send a text message to continue."
      );
      res.sendStatus(200);
      return;
    }

    try {
      await this.processTextMessage(message);
      res.sendStatus(200);
    } catch (error) {
      await this.services.whatsappService.sendMessage(
        message.from, 
        "An unexpected error occurred while processing your message. Please try again later."
      );
      logger.error({ err: error, message }, "Error processing webhook message");
      res.sendStatus(400);
    }
  }

  private async processTextMessage(message: WebhookMessage): Promise<void> {
    const phone = message.from;
    let existingSubscriber = await this.services.subscriberService.getSubscriber(phone);
    const isInOnboarding = await this.services.onboardingService.isInOnboarding(phone);

    // Handle new users and onboarding flow
    if (!existingSubscriber && !isInOnboarding) {
      await this.startNewUserOnboarding(phone, message.text!.body);
      return;
    }

    if (!existingSubscriber && isInOnboarding) {
      await this.continueOnboarding(phone, message.text!.body);
      return;
    }

    if (existingSubscriber && isInOnboarding) {
      await this.services.onboardingService.completeOnboarding(phone);
      await this.services.languageBuddyAgent.clearConversation(existingSubscriber.connections.phone);
    }

    const subscriber = existingSubscriber ?? await this.services.subscriberService.getSubscriber(phone);
    if (!subscriber) {
      logger.error({ phone }, "Subscriber should exist at this point but doesn't");
      return;
    }

    // Handle user commands
    if (await handleUserCommand(
      subscriber, 
      message.text!.body, 
      this.services.whatsappService, 
      this.services.languageBuddyAgent
    ) !== 'nothing') {
      await this.services.whatsappService.markMessageAsRead(message.id);
      return;
    }

    // Check throttling
    if (await this.services.whatsappDeduplicationService.isThrottled(phone)) {
      logger.info({ phone }, 'User is throttled, message ignored.');
      await this.services.whatsappService.sendMessage(
        phone, 
        "You are sending messages too quickly. Please wait a few seconds between messages."
      );
      return;
    }

    // Handle missing profile information
    const missingField = getNextMissingField(subscriber);
    if (missingField != null) {
      await this.handleMissingProfileInfo(subscriber, missingField);
      return;
    }

    // Process regular conversation
    await this.handleRegularConversation(subscriber, message);
  }

  private async startNewUserOnboarding(phone: string, messageBody: string): Promise<void> {
    await this.services.onboardingService.startOnboarding(phone);
    const systemPrompt = generateOnboardingSystemPrompt();
    const welcomeMessage = await this.services.languageBuddyAgent.initiateConversation(
      { connections: { phone } } as Subscriber,
      systemPrompt,
      messageBody
    );
    await this.services.whatsappService.sendMessage(phone, welcomeMessage);
  }

  private async continueOnboarding(phone: string, messageBody: string): Promise<void> {
    const response = await this.services.languageBuddyAgent.processUserMessage(
      { connections: { phone } } as Subscriber,
      messageBody
    );
    await this.services.whatsappService.sendMessage(phone, response);
  }

  private async handleMissingProfileInfo(subscriber: Subscriber, missingField: string): Promise<void> {
    const phone = subscriber.connections.phone;
    const language = subscriber.profile.speakingLanguages[0]?.languageName || "english";
    
    const response = await this.services.languageBuddyAgent.oneShotMessage(
      getPromptForField(missingField),
      language,
      phone
    );
    await this.services.whatsappService.sendMessage(phone, response);
  }

  private async handleRegularConversation(subscriber: Subscriber, message: WebhookMessage): Promise<void> {
    const phone = subscriber.connections.phone;

    await this.services.whatsappService.markMessageAsRead(message.id);

    trackEvent("text_message_received", {
      userPhone: phone.slice(-4),
      messageLength: message.text!.body.length,
      timestamp: new Date().toISOString()
    });

    const startTime = Date.now();
    let response: string;

    if (!await this.services.languageBuddyAgent.currentlyInActiveConversation(phone)) {
      logger.info({ userPhone: phone }, "No active conversation found, initiating new conversation");
      const systemPrompt = generateRegularSystemPrompt(subscriber, getFirstLearningLanguage(subscriber));
      response = await this.services.languageBuddyAgent.initiateConversation(
        subscriber, 
        systemPrompt, 
        message.text!.body
      );
    } else {
      response = await this.services.languageBuddyAgent.processUserMessage(subscriber, message.text!.body);
    }

    const processingTime = Date.now() - startTime;
    trackMetric("message_processing_time_ms", processingTime, {
      userPhone: phone.slice(-4),
      responseLength: response?.length || 0
    });

    if (response && response.trim() !== "") {
      await this.services.whatsappService.sendMessage(phone, response);
      trackEvent("response_sent", {
        userPhone: phone.slice(-4),
        responseLength: response.length,
        processingTimeMs: processingTime
      });
    } else {
      logger.warn({ userPhone: phone }, "Empty response from LangGraph agent");
      trackEvent("empty_response", { userPhone: phone.slice(-4) });
    }
  }
}
