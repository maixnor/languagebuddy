import * as cron from 'node-cron';
import { logger, config } from '../config';
import { SubscriberService } from '../services/subscriber-service';
import { WhatsAppService } from '../services/whatsapp-service';
import { LanguageBuddyAgent } from '../agents/language-buddy-agent';
import { SystemPromptEntry } from '../types';
import { createConversationDigestTool } from '../tools/conversation-tools';

export class SchedulerService {
  private static instance: SchedulerService;
  private subscriberService: SubscriberService;
  private whatsappService: WhatsAppService;
  private languageBuddyAgent: LanguageBuddyAgent;
  private dailyPrompt: SystemPromptEntry;

  private constructor(
    subscriberService: SubscriberService, 
    languageBuddyAgent: LanguageBuddyAgent,
    dailyPrompt: SystemPromptEntry
  ) {
    this.subscriberService = subscriberService;
    this.whatsappService = WhatsAppService.getInstance();
    this.languageBuddyAgent = languageBuddyAgent;
    this.dailyPrompt = dailyPrompt;
  }

  static getInstance(
    subscriberService?: SubscriberService, 
    languageBuddyAgent?: LanguageBuddyAgent,
    dailyPrompt?: SystemPromptEntry
  ): SchedulerService {
    if (!SchedulerService.instance) {
      if (!subscriberService || !languageBuddyAgent || !dailyPrompt) {
        throw new Error("All parameters required for first initialization");
      }
      SchedulerService.instance = new SchedulerService(subscriberService, languageBuddyAgent, dailyPrompt);
    }
    return SchedulerService.instance;
  }

  startSchedulers(): void {
    this.startDailyMessageScheduler();
    this.startNighttimeDigestScheduler();
    this.startFreeUserHistoryCleaner();
    
    logger.info("All schedulers started successfully");
  }

  private startDailyMessageScheduler(): void {
    if (!config.features.dailyMessages.enabled) {
      logger.info("Daily messages disabled in config");
      return;
    }

    // Schedule daily messages at 9 AM UTC (adjust based on config)
    const dailyTime = config.features.dailyMessages.timeToSend || '09:00';
    const [hour, minute] = dailyTime.split(':');
    
    // Cron format: minute hour day month dayOfWeek
    const cronExpression = `${minute} ${hour} * * *`;
    
    cron.schedule(cronExpression, async () => {
      logger.info("Starting daily message broadcast");
      await this.sendDailyMessages();
    }, {
      timezone: config.features.dailyMessages.timezone
    });

    logger.info({ time: dailyTime, timezone: config.features.dailyMessages.timezone }, "Daily message scheduler started");
  }

  private startNighttimeDigestScheduler(): void {
    // Schedule digest creation at 3 AM UTC
    const nightTime = config.features.nighttime.digestCreationTime || '03:00';
    const [hour, minute] = nightTime.split(':');
    
    const cronExpression = `${minute} ${hour} * * *`;
    
    cron.schedule(cronExpression, async () => {
      logger.info("Starting nightly digest creation");
      await this.createNightlyDigests();
    }, {
      timezone: config.features.nighttime.timezone
    });

    logger.info({ time: nightTime }, "Nightly digest scheduler started");
  }

  private startFreeUserHistoryCleaner(): void {
    // Schedule free user history cleanup at 3:30 AM UTC
    const cleanupTime = config.features.nighttime.conversationResetTime || '03:00';
    const [hour, minute] = cleanupTime.split(':');
    const cleanupMinute = parseInt(minute) + 30; // 30 minutes after digest creation
    
    const cronExpression = `${cleanupMinute} ${hour} * * *`;
    
    cron.schedule(cronExpression, async () => {
      logger.info("Starting free user history cleanup");
      await this.cleanupFreeUserHistory();
    }, {
      timezone: config.features.nighttime.timezone
    });

    logger.info({ time: `${hour}:${cleanupMinute.toString().padStart(2, '0')}` }, "Free user history cleanup scheduler started");
  }

  private async sendDailyMessages(): Promise<void> {
    try {
      const subscribers = await this.subscriberService.getAllSubscribers();
      const premiumSubscribers = subscribers.filter(s => s.isPremium);
      
      logger.info({ totalSubscribers: subscribers.length, premiumSubscribers: premiumSubscribers.length }, "Starting daily message sending");

      for (const subscriber of premiumSubscribers) {
        try {
          // Only send to users who haven't been active in the last 8 hours
          const lastActive = subscriber.lastActiveAt ? new Date(subscriber.lastActiveAt) : new Date(0);
          const hoursInactive = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60);
          
          if (hoursInactive >= 8) {
            const dailyMessage = await this.languageBuddyAgent.initiateConversation(
              subscriber.phone, 
              this.dailyPrompt
            );
            
            await this.whatsappService.sendMessage(subscriber.phone, dailyMessage);
            
            // Add small delay to avoid rate limiting
            await this.delay(2000);
            
            logger.info({ phoneNumber: subscriber.phone }, "Daily message sent");
          } else {
            logger.debug({ phoneNumber: subscriber.phone, hoursInactive }, "Skipping daily message - user recently active");
          }
        } catch (error) {
          logger.error({ err: error, phoneNumber: subscriber.phone }, "Error sending daily message to subscriber");
        }
      }
      
      logger.info("Daily message sending completed");
    } catch (error) {
      logger.error({ err: error }, "Error during daily message broadcast");
    }
  }

  private async createNightlyDigests(): Promise<void> {
    try {
      const subscribers = await this.subscriberService.getAllSubscribers();
      
      logger.info({ totalSubscribers: subscribers.length }, "Starting nightly digest creation");

      for (const subscriber of subscribers) {
        try {
          // Get today's conversation history for the user
          const conversationHistory = await this.getConversationHistory(subscriber.phone);
          
          if (conversationHistory.length > 0) {
            // Create digest using the tool
            await createConversationDigestTool.invoke({
              conversationHistory,
              phoneNumber: subscriber.phone
            });
            
            logger.info({ phoneNumber: subscriber.phone, messagesCount: conversationHistory.length }, "Digest created");
          } else {
            logger.debug({ phoneNumber: subscriber.phone }, "No conversation history for digest creation");
          }
        } catch (error) {
          logger.error({ err: error, phoneNumber: subscriber.phone }, "Error creating digest for subscriber");
        }
      }
      
      logger.info("Nightly digest creation completed");
    } catch (error) {
      logger.error({ err: error }, "Error during nightly digest creation");
    }
  }

  private async cleanupFreeUserHistory(): Promise<void> {
    try {
      const subscribers = await this.subscriberService.getAllSubscribers();
      const freeUsers = subscribers.filter(s => !s.isPremium);
      
      logger.info({ freeUsers: freeUsers.length }, "Starting free user history cleanup");

      for (const subscriber of freeUsers) {
        try {
          await this.subscriberService.clearUserHistoryForFreeUser(subscriber.phone);
          logger.debug({ phoneNumber: subscriber.phone }, "History cleared for free user");
        } catch (error) {
          logger.error({ err: error, phoneNumber: subscriber.phone }, "Error clearing history for free user");
        }
      }
      
      logger.info("Free user history cleanup completed");
    } catch (error) {
      logger.error({ err: error }, "Error during free user history cleanup");
    }
  }

  private async getConversationHistory(phoneNumber: string): Promise<string[]> {
    // This would extract conversation history from Redis checkpoints
    // For now, return empty array - would need to implement based on your Redis structure
    try {
      // TODO: Implement actual conversation history extraction
      // This should get today's messages from the Redis checkpoint
      return [];
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error getting conversation history");
      return [];
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Manual methods for testing
  async triggerDailyMessages(): Promise<void> {
    logger.info("Manually triggering daily messages");
    await this.sendDailyMessages();
  }

  async triggerNightlyDigests(): Promise<void> {
    logger.info("Manually triggering nightly digests");
    await this.createNightlyDigests();
  }

  async triggerHistoryCleanup(): Promise<void> {
    logger.info("Manually triggering history cleanup");
    await this.cleanupFreeUserHistory();
  }
}