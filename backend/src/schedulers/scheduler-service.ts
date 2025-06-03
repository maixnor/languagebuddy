import * as cron from 'node-cron';
import { logger, config } from '../config';
import { SubscriberService } from '../services/subscriber-service';
import { WhatsAppService } from '../services/whatsapp-service';
import { LanguageBuddyAgent } from '../agents/language-buddy-agent';
import { SystemPromptEntry } from '../types';

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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Manual methods for testing
  async triggerDailyMessages(): Promise<void> {
    logger.info("Manually triggering daily messages");
    await this.sendDailyMessages();
  }

  async triggerNightlyDigests(): Promise<void> {
    logger.info("TODO Manually triggering nightly digests");
    //await this.createNightlyDigests();
  }

  async triggerHistoryCleanup(): Promise<void> {
    logger.info("TODO Manually triggering history cleanup");
    // await this.cleanupFreeUserHistory();
  }
}