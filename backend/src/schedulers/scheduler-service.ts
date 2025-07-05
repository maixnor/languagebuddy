import * as cron from 'node-cron';
import { logger, config } from '../config';
import { SubscriberService } from '../services/subscriber-service';
import { WhatsAppService } from '../services/whatsapp-service';
import { LanguageBuddyAgent } from '../agents/language-buddy-agent';

export class SchedulerService {
  private static instance: SchedulerService;
  private subscriberService: SubscriberService;
  private whatsappService: WhatsAppService;
  private languageBuddyAgent: LanguageBuddyAgent;

  private constructor(
    subscriberService: SubscriberService, 
    languageBuddyAgent: LanguageBuddyAgent,
  ) {
    this.subscriberService = subscriberService;
    this.whatsappService = WhatsAppService.getInstance();
    this.languageBuddyAgent = languageBuddyAgent;
  }

  static getInstance(
    subscriberService?: SubscriberService, 
    languageBuddyAgent?: LanguageBuddyAgent,
  ): SchedulerService {
    if (!SchedulerService.instance) {
      if (!subscriberService || !languageBuddyAgent) {
        throw new Error("All parameters required for first initialization");
      }
      SchedulerService.instance = new SchedulerService(subscriberService, languageBuddyAgent);
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

    // TODO start every hour and send to everyone at their local time at 9
    // TODO add a random offset to the invocation such that users don't get a message every day like clockwork
    const dailyTime = config.features.dailyMessages.localTime || '9:00';
    const [hour, minute] = dailyTime.split(':');
    
    // Cron format: minute hour day month dayOfWeek
    const cronExpression = `${minute} ${hour} * * *`;
    cron.schedule(
      cronExpression, 
      async () => {
        logger.info("Starting daily message broadcast");
        await this.sendDailyMessages();
      }, 
    );

    logger.info(`Daily message scheduler started for ${hour}:${minute} ${config.features.dailyMessages.localTime} every day`);
  }

  private async sendDailyMessages(): Promise<void> {
    try {
      const subscribers = await this.subscriberService.getAllSubscribers()
      const premiumSubscribers = subscribers.filter(s => s.isPremium);
      
      logger.info({ totalSubscribers: subscribers.length, premiumSubscribers: premiumSubscribers.length }, "Starting daily message sending");

      for (const subscriber of subscribers) {
        try {
          const dailyMessage = await this.languageBuddyAgent.initiateConversation(
            subscriber,
            this.subscriberService.getDailySystemPrompt(subscriber),
            ""
          );
          
          await this.whatsappService.sendMessage(subscriber.connections.phone, dailyMessage);
          
          logger.trace({ phoneNumber: subscriber.connections.phone }, "Daily message sent");
        } catch (error) {
          logger.error({ err: error, phoneNumber: subscriber.connections.phone }, "Error sending daily message to subscriber");
        }
      }
      
      logger.info("Daily message sending completed");
    } catch (error) {
      logger.error({ err: error }, "Error during daily message broadcast");
    }
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