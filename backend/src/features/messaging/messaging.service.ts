import { ServiceContainer } from '../../core/container';
import { logger, trackEvent, trackMetric, config } from '../../core/config';
import { WebhookMessage } from './messaging.types';
import { Subscriber } from '../subscriber/subscriber.types';
import { handleUserCommand } from '../../agents/agent.user-commands';
import { getNextMissingField, getPromptForField, sanitizePhoneNumber } from '../subscriber/subscriber.utils';
import { generateSystemPrompt, generateDefaultSystemPromptForSubscriber } from '../subscriber/subscriber.prompts';
import { generateOnboardingSystemPrompt } from '../onboarding/onboarding.prompts';
import { getFirstLearningLanguage } from "../subscriber/subscriber.utils";
import { DateTime } from "luxon";
import { traceConversation } from '../../core/observability/tracing';
import { recordThrottledMessage, recordConversationMessage } from '../../core/observability/metrics';
import { TelegramUpdate } from '../../core/messaging/telegram/telegram.types';
import { TelegramService } from '../../core/messaging/telegram/telegram.service';

export class MessagingService {
  constructor(private services: ServiceContainer) {}

  async handleTelegramWebhookMessage(body: any, res: any): Promise<void> {
    try {
      const update: TelegramUpdate = body;
      logger.info('Received Telegram update', { update_id: update.update_id });

      if (!update.message || !update.message.text || !update.message.chat) {
         res.sendStatus(200);
         return;
      }

      const chatId = update.message.chat.id;
      const text = update.message.text;
      const username = update.message.from?.username ? `@${update.message.from.username}` : undefined;

      // 1. Find or Create Subscriber
      let subscriber = await this.services.subscriberService.getSubscriberByTelegramChatId(chatId);
      
      if (!subscriber) {
          // Create new subscriber with pseudo-phone
          // Using a prefix to avoid collision with real numbers, though sanitizePhoneNumber enforces +digits.
          // We use the Chat ID directly if possible.
          const pseudoPhone = `+${chatId}`; 
          
          subscriber = await this.services.subscriberService.createSubscriber(pseudoPhone, {
              connections: {
                  phone: pseudoPhone,
                  telegram: {
                      chatId: chatId,
                      username: username
                  }
              }
          });
      } else {
          // Update username if changed
          if (subscriber.connections.telegram?.username !== username) {
             const updatedConnections = {
                 ...subscriber.connections,
                 telegram: {
                     chatId,
                     username
                 }
             };
             await this.services.subscriberService.updateSubscriber(subscriber.connections.phone, {
                 connections: updatedConnections
             });
             subscriber.connections = updatedConnections;
          }
      }

      await this.handleTelegramConversation(subscriber, text, chatId);
      res.sendStatus(200);
    } catch (error) {
      logger.error('Failed to process Telegram webhook', { error, body });
      res.sendStatus(400);
    }
  }

  private async handleTelegramConversation(subscriber: Subscriber, text: string, chatId: number): Promise<void> {
    const phone = subscriber.connections.phone;
    
    // Determine subscriber type for metrics
    let subscriberType: 'premium' | 'trial' | 'free' = 'trial';
    if (subscriber) {
      subscriberType = subscriber.isPremium ? 'premium' :
                       (this.services.subscriberService.getDaysSinceSignup(subscriber) < config.subscription.trialDays ? 'trial' : 'free');
    }

    recordConversationMessage('user', subscriberType);

    // Create a messenger adapter that replies to the current Telegram chat
    const telegramMessenger = {
        sendMessage: async (_to: string, message: string) => {
            await this.services.telegramService.sendMessage({
                chat_id: chatId,
                text: message
            });
        }
    };

    // Handle user commands
    // We pass the telegramMessenger which ignores the phone number arg and sends to the current chatId
    if (await handleUserCommand(
      subscriber, 
      text, 
      telegramMessenger, 
      this.services.languageBuddyAgent
    ) !== 'nothing') {
      return;
    }

    await traceConversation('process_telegram_message', phone, async (span) => {
        let agentResult: { response: string; updatedSubscriber: Subscriber };

        // Check for active conversation
        if (!await this.services.languageBuddyAgent.currentlyInActiveConversation(phone)) {
             agentResult = await this.services.languageBuddyAgent.initiateConversation(
                 subscriber,
                 text
             );
        } else {
             agentResult = await this.services.languageBuddyAgent.processUserMessage(
                 subscriber,
                 text
             );
        }
        
        const response = agentResult.response;
        
        if (response && response.trim() !== "") {
            await this.services.telegramService.sendMessage({
                chat_id: chatId,
                text: response
            });
            
            recordConversationMessage('ai', subscriberType);
            trackEvent("telegram_response_sent", {
                userPhone: phone, // using pseudo-phone
                responseLength: response.length
            });
        }
    });
  }

  async handleInitiateRequest(body: any, res: any): Promise<void> {
    const phone = sanitizePhoneNumber(body.phone);

    if (!phone) {
      res.status(400).send("Missing 'phone' in request body.");
      return;
    }

    let subscriber = await this.services.subscriberService.getSubscriber(phone) ?? 
                    await this.services.subscriberService.createSubscriber(phone);

    const hasPaid = await this.services.subscriptionService.checkSubscription(phone);
    if (!hasPaid) {
      logger.info({ phone }, "/initiate: User has not paid at Stripe.");
    } else {
      logger.info({ phone }, "/initiate: User has paid. Proceeding with initiation.");
    }

    // Check throttling and subscription limits
    if (this.services.subscriberService.shouldThrottle(subscriber)) {
      const canStart = await this.services.subscriberService.canStartConversationToday(phone);
      if (!canStart) {
        const paymentLink = await this.services.subscriptionService.getPaymentLink(phone);
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
      'The Conversation is not being initialized by the User, but by an automated System. Start off with a conversation opener in your next message, then continue the conversation.', // Human message for system initiation
      selectedPrompt // Actual system prompt
    );

    if (initialMessage) {
      await this.services.subscriberService.incrementConversationCount(phone);
      await this.services.whatsappService.sendMessage(phone, initialMessage);
      
      if (this.services.subscriberService.shouldPromptForSubscription(subscriber)) {
        const paymentLink = await this.services.subscriptionService.getPaymentLink(phone);
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

    if (!message || !message.from) {
      res.sendStatus(200);
      return;
    }

    // Check for duplicate messages
    // We use recordMessageProcessed which tries to insert and returns true if it was a duplicate
    if (message.id && await this.services.whatsappDeduplicationService.recordMessageProcessed(message.id)) {
      logger.trace({ messageId: message.id }, 'Duplicate webhook event ignored.');
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
    const phone = sanitizePhoneNumber(message.from);
    let subscriber = await this.services.subscriberService.getSubscriber(phone);

    // If subscriber doesn't exist, create one in 'onboarding' status
    if (!subscriber) {
      subscriber = await this.services.subscriberService.createSubscriber(phone);
      logger.info({ phone }, "Created new subscriber for onboarding");
    }

    // Get subscriber type for metrics
    let subscriberType: 'premium' | 'trial' | 'free' = 'trial';
    if (subscriber) {
      subscriberType = subscriber.isPremium ? 'premium' :
                       (this.services.subscriberService.getDaysSinceSignup(subscriber) < config.subscription.trialDays ? 'trial' : 'free');
    }

    // Record user message
    recordConversationMessage('user', subscriberType);
    
    // Update lastMessageSentAt (for active subscribers)
    try {
      if (subscriber.status === 'active') {
          await this.services.subscriberService.updateSubscriber(phone, { lastMessageSentAt: new Date() });
      }
    } catch (error) {
      logger.error({ err: error, phone }, "Failed to update lastMessageSentAt");
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

    // Check throttling and subscription limits (skip for onboarding)
    if (subscriber && subscriber.status === 'active' && this.services.subscriberService.shouldThrottle(subscriber)) {
      const hasPaid = await this.services.subscriptionService.checkSubscription(phone);
      if (hasPaid) {
        if (!subscriber.isPremium) {
          await this.services.subscriberService.updateSubscriber(phone, { isPremium: true });
          subscriber.isPremium = true;
          logger.info({ phone }, "User upgraded to premium via Stripe check.");
        }
      } else {
        logger.info({ phone }, "User throttled and has not paid. Blocking.");
        const paymentLink = await this.services.subscriptionService.getPaymentLink(phone);
        await this.services.whatsappService.sendMessage(
          phone, 
          `⏳ Your 7-day trial has ended. To continue your language journey with unlimited conversations, please subscribe here: ${paymentLink}`
        );
        recordConversationMessage('ai', subscriberType);
        recordThrottledMessage();
        return;
      }
    }

    // Process regular conversation (or onboarding via agent router)
    await this.handleRegularConversation(subscriber, message);
  }

  
  private async handleRegularConversation(subscriber: Subscriber, message: WebhookMessage, externalSystemPromptOverride?: string): Promise<void> {
    const phone = subscriber.connections.phone;
    const startTime = Date.now();
    
    // Determine subscriber type for metrics (re-calculate as it might change or to ensure availability)
    let subscriberType: 'premium' | 'trial' | 'free' = 'trial';
    if (subscriber) {
      subscriberType = subscriber.isPremium ? 'premium' :
                       (this.services.subscriberService.getDaysSinceSignup(subscriber) < config.subscription.trialDays ? 'trial' : 'free');
    }

    // Wrap the entire conversation handling in a trace span
    await traceConversation('process_message', phone, async (span) => {
      await this.services.whatsappService.markMessageAsRead(message.id);

      trackEvent("text_message_received", {
        userPhone: phone.slice(-4),
        messageLength: message.text!.body.length,
        timestamp: new Date().toISOString()
      });

      const originalSubscriberStatus = subscriber.status;
      let agentResult: { response: string; updatedSubscriber: Subscriber };

      let systemPromptOverride: string | undefined = externalSystemPromptOverride;
      
      // If subscriber is in onboarding status, use the onboarding system prompt
      if (subscriber && subscriber.status === 'onboarding') {
        systemPromptOverride = generateOnboardingSystemPrompt();
      } else if (!systemPromptOverride && this.services.subscriberService.shouldShowSubscriptionWarning(subscriber)) {
        const paymentLink = await this.services.subscriptionService.getPaymentLink(phone);
        
        const currentLocalTime = DateTime.local().setZone(subscriber.profile.timezone || config.fallbackTimezone);
        const lastDigestTopic = subscriber.metadata?.digests?.[0]?.topic || null;
        
        // Fetch context for prompt generation
        const conversationDurationMinutes = await this.services.languageBuddyAgent.getConversationDuration(phone);
        const timeSinceLastMessageMinutes = await this.services.languageBuddyAgent.getTimeSinceLastMessage(phone);

        const basePrompt = generateSystemPrompt({
          subscriber,
          conversationDurationMinutes,
          timeSinceLastMessageMinutes,
          currentLocalTime,
          lastDigestTopic,
        });

        systemPromptOverride = basePrompt + `\n\nIMPORTANT SYSTEM INSTRUCTION:
  The user's free trial is ending soon (Day 6 or 7).
  At the end of your response, you MUST explain in the user's target language that their trial is ending soon and they should subscribe to keep using the service.
  Payment Link: ${paymentLink}
  Make it sound natural, encouraging, and helpful. Do not be aggressive;`;
      }

      if (!await this.services.languageBuddyAgent.currentlyInActiveConversation(phone)) {
        logger.info({ userPhone: phone }, "No active conversation found, initiating new conversation");
        
        agentResult = await this.services.languageBuddyAgent.initiateConversation(
          subscriber, 
          message.text!.body, 
          systemPromptOverride
        );
      } else {
        agentResult = await this.services.languageBuddyAgent.processUserMessage(
          subscriber, 
          message.text!.body,
          systemPromptOverride
        );
      }

      // If onboarding completed, clear the conversation checkpoint
      if (originalSubscriberStatus === 'onboarding' && agentResult.updatedSubscriber.status === 'active') {
        logger.info({ phone }, "Onboarding completed. Clearing conversation checkpoint.");
        await this.services.languageBuddyAgent.clearConversation(phone);
        subscriber = agentResult.updatedSubscriber; // Update subscriber to reflect active status

        // Send a confirmation message that onboarding is complete
        await this.services.whatsappService.sendMessage(
          phone,
          "🎉 Great! Your Language Buddy profile has been successfully created."
        );

        // Now initiate a new regular conversation after onboarding completion
        const selectedPrompt = this.services.subscriberService.getDailySystemPrompt(subscriber);
        const newConversationAgentResult = await this.services.languageBuddyAgent.initiateConversation(
          subscriber,
          'The Conversation is not being initialized by the User, but by an automated System. Start off with a conversation opener in your next message, then continue the conversation.',
          selectedPrompt
        );
        agentResult.response = newConversationAgentResult.response; // Use response from new conversation
        agentResult.updatedSubscriber = newConversationAgentResult.updatedSubscriber; // Update subscriber again
      }

      const response = agentResult.response;
      const processingTime = Date.now() - startTime;
      trackMetric("message_processing_time_ms", processingTime, {
        userPhone: phone.slice(-4),
        responseLength: response?.length || 0
      });

      if (response && response.trim() !== "") {
        await this.services.whatsappService.sendMessage(phone, response);
        recordConversationMessage('ai', subscriberType); // AI response
        trackEvent("response_sent", {
          userPhone: phone.slice(-4),
          responseLength: response.length,
          processingTimeMs: processingTime
        });
      } else {
        logger.warn({ userPhone: phone }, "Empty response from LangGraph agent");
        trackEvent("empty_response", { userPhone: phone.slice(-4) });
      }
    });
  }
}
