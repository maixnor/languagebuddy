import * as cron from 'node-cron';
import { logger, config } from '../../config';
import { SubscriberService } from '../subscriber/subscriber.service';
import { ensureValidTimezone } from '../subscriber/subscriber.utils';
import { WhatsAppService } from '../../core/messaging/whatsapp';
import { DigestService } from '../digest/digest.service';
import { LanguageBuddyAgent } from '../../agents/language-buddy-agent';
import { DateTime } from 'luxon';
import { Subscriber } from '../subscriber/subscriber.types';

export class SchedulerService {
  private static instance: SchedulerService;
  private subscriberService: SubscriberService;
  private whatsappService: WhatsAppService;
  private digestService: DigestService;
  private languageBuddyAgent: LanguageBuddyAgent;

  private constructor(
    subscriberService: SubscriberService, 
    languageBuddyAgent: LanguageBuddyAgent,
  ) {
    this.subscriberService = subscriberService;
    this.whatsappService = WhatsAppService.getInstance();
    this.digestService = DigestService.getInstance();
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
    this.startNightlyDigestScheduler();
    this.startRegularPushMessageScheduler();
  }

  private startNightlyDigestScheduler(): void {
    // Run hourly for nightly digest checks
    cron.schedule('0 * * * *', async () => {
      logger.info("Running nightly digest scheduler...");
      await this.processNightlyDigests(); // This method will be created next
    });
  }

  private startRegularPushMessageScheduler(): void {
    // Run every minute for regular push messages
    cron.schedule('* * * * *', async () => {
      logger.trace("Running regular push message scheduler...");
      await this.processRegularPushMessages(); // This method will contain the original sendPushMessages logic
    });
  }

  public isNightTimeForUser(subscriber: Subscriber, nowOverride?: DateTime): boolean {
    const tz = ensureValidTimezone(subscriber.profile.timezone);
    const now = nowOverride ? nowOverride.setZone(tz) : DateTime.now().setZone(tz);
    // Check if it's between 3 AM and 3:59 AM local time
    return now.hour === 3;
  }

  public shouldSendReengagementMessage(subscriber: Subscriber, nowUtc: DateTime): boolean {
    if (!subscriber.lastMessageSentAt) {
      return false; // No last message sent date, so no re-engagement
    }
    const lastSent = DateTime.fromISO(subscriber.lastMessageSentAt, { zone: 'utc' });
    const diff = nowUtc.diff(lastSent, 'days').days;
    return diff >= 3;
  }



  /**
   * Execute nightly tasks for a single subscriber:
   * 1. Increment conversation count
   * 2. Create digest from current conversation
   * 3. Clear conversation history
   * 4. Initiate new conversation with daily system prompt
   * 5. Send the new conversation message
   * 
   * @param subscriber - The subscriber to process
   * @returns The message that was sent to the subscriber, or null if failed
   */
  async executeNightlyTasksForSubscriber(subscriber: Subscriber): Promise<string | null> {
    try {
      await this.subscriberService.incrementConversationCount(subscriber.connections.phone);
      
      // Create digest before clearing conversation history
      try {
        await this.subscriberService.createDigest(subscriber);
        logger.debug({ phoneNumber: subscriber.connections.phone }, "Digest created before conversation reset");
      } catch (digestError) {
        logger.error({ err: digestError, phoneNumber: subscriber.connections.phone }, "Failed to create digest before conversation reset");
        // Continue with conversation reset even if digest creation fails
      }
      
      // Clean up old digests (older than 10 days)
      try {
        const removedCount = await this.digestService.removeOldDigests(subscriber.connections.phone, 10);
        if (removedCount > 0) {
          logger.debug({ phoneNumber: subscriber.connections.phone, removedCount }, "Removed old digests during nightly tasks");
        }
      } catch (cleanupError) {
        logger.error({ err: cleanupError, phoneNumber: subscriber.connections.phone }, "Failed to clean up old digests");
        // Continue with other nightly tasks even if cleanup fails
      }
      
      await this.languageBuddyAgent.clearConversation(subscriber.connections.phone);
      const message = await this.languageBuddyAgent.initiateConversation(
        subscriber,
        "",
        this.subscriberService.getDailySystemPrompt(subscriber)
      );
      
      const messageSent = await this.whatsappService.sendMessage(subscriber.connections.phone, message);
      
      if (messageSent.failed === 0) {
        logger.trace({ 
          phoneNumber: subscriber.connections.phone
        }, "Nightly tasks completed and message sent successfully");
        return message;
      } else {
        logger.error({ phoneNumber: subscriber.connections.phone }, "Failed to send message after nightly tasks");
        return null;
      }
    } catch (error) {
      logger.error({ err: error, phoneNumber: subscriber.connections.phone }, "Error executing nightly tasks for subscriber");
      return null;
    }
  }

  public async processNightlyDigests(): Promise<void> {
    if (config.features.dailyMessages.enabled === false) return; // Assuming this flag also controls digests
    try {
      const subscribers = await this.subscriberService.getAllSubscribers();
      const nowUtc = DateTime.utc();
      for (const subscriber of subscribers) {
        const subscriberTimezone = ensureValidTimezone(subscriber.profile.timezone);
        const nowLocal = nowUtc.setZone(subscriberTimezone);
        const todayLocalIso = nowLocal.toISODate();
        const lastDigestRun = subscriber.metadata?.lastNightlyDigestRun;
        const lastDigestRunIso = lastDigestRun instanceof Date 
            ? DateTime.fromJSDate(lastDigestRun).toISODate() 
            : lastDigestRun;
  
        if (this.isNightTimeForUser(subscriber, nowLocal) && lastDigestRunIso !== todayLocalIso) {
          logger.info({ phoneNumber: subscriber.connections.phone, localTime: nowLocal.toISO(), lastRun: lastDigestRunIso }, "Triggering nightly digest tasks for subscriber.");
          const messageSent = await this.executeNightlyTasksForSubscriber(subscriber); // This also sends the initial message for the new day
  
          if (messageSent) {
            // Update lastNightlyDigestRun only if tasks were successfully executed
            const updatedMetadata = {
              ...subscriber.metadata,
              lastNightlyDigestRun: todayLocalIso,
            };
            await this.subscriberService.updateSubscriber(subscriber.connections.phone, {
              metadata: updatedMetadata,
            });
            logger.info({ phoneNumber: subscriber.connections.phone }, "Nightly digest tasks completed and lastNightlyDigestRun updated.");
          } else {
            logger.error({ phoneNumber: subscriber.connections.phone }, "Nightly digest tasks failed for subscriber. Not updating lastNightlyDigestRun.");
          }
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error during nightly digest processing");
    }
  }

  public async processRegularPushMessages(): Promise<void> {
    if (config.features.dailyMessages.enabled === false) return;
    try {
      const subscribers = await this.subscriberService.getAllSubscribers();
      const nowUtc = DateTime.utc(); // Get nowUtc once for all subscribers
      for (const subscriber of subscribers) {
        // Nightly Digest logic is now handled by processNightlyDigests
        // No more 'continue' here for nightly digest
      
        let nextPush: DateTime | undefined;
        let shouldSendMessage = false;        
        if (!subscriber.nextPushMessageAt) {
          // If not set, send message immediately and schedule for +24h from now
          shouldSendMessage = true;
          nextPush = nowUtc.plus({ hours: 24 });
        } else {
          nextPush = DateTime.fromISO(subscriber.nextPushMessageAt, { zone: 'utc' });
          if (!nextPush.isValid) {
            // If invalid, send message immediately and schedule for +24h from now
            shouldSendMessage = true;
            nextPush = nowUtc.plus({ hours: 24 });
          } else {
            // Check if it's time to send the message
            shouldSendMessage = nowUtc >= nextPush;
          }
        }
        
        if (!shouldSendMessage) continue;

        if (this.subscriberService.shouldShowSubscriptionWarning(subscriber)) {
          await this.whatsappService.sendMessage(subscriber.connections.phone, "⚠️ You have reached the maximum number of messages allowed for your plan. Please upgrade to continue chatting right now or come back tomorrow :)");
          // Set next push to tomorrow to prevent spam
          await this.subscriberService.updateSubscriber(subscriber.connections.phone, { 
            nextPushMessageAt: nowUtc.plus({ hours: 24 }).toISO()
          });
          continue;
        }
        
        // Calculate next push time BEFORE sending to prevent multiple sends
        const nextTime = this.calculateNextPushTime(subscriber);
        if (!nextTime) {
          logger.error({ phoneNumber: subscriber.connections.phone }, "Failed to calculate next push time, skipping subscriber");
          continue;
        }
        
        const nextTimeUtc = nextTime.toUTC();
        
        // If the calculated next time is not sufficiently in the future, 
        // adjust it but still send the current message (they deserve it!)
        let finalNextTime = nextTimeUtc;
        if (nextTimeUtc <= nowUtc.plus({ minutes: 5 })) {
          logger.warn({ 
            phoneNumber: subscriber.connections.phone,
            calculatedNext: nextTimeUtc.toISO(),
            now: nowUtc.toISO()
          }, "Calculated next push time too close, adjusting to tomorrow");
          finalNextTime = nowUtc.plus({ hours: 23 });
        }
        
        // Update next push time immediately to prevent duplicate sends
        await this.subscriberService.updateSubscriber(subscriber.connections.phone, { 
          nextPushMessageAt: finalNextTime.toISO()
        });
        
        // Execute nightly tasks and send message (Removed: This was for nightly digest related message)
        // For regular push messages, we send a re-engagement message here if needed
        if (this.shouldSendReengagementMessage(subscriber, nowUtc)) {
          const reengagementMessage = "Hey! It's been a while. Shall we continue our language practice?";
          await this.whatsappService.sendMessage(subscriber.connections.phone, reengagementMessage);
          logger.info({ phoneNumber: subscriber.connections.phone }, "Re-engagement message sent.");
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error during regular push message processing");
    }
  }

  public calculateNextPushTime(subscriber: Subscriber, nowOverride?: DateTime): DateTime | undefined {
    // Determine user timezone
    const tz = ensureValidTimezone(subscriber.profile.timezone);
    const prefs = subscriber.profile.messagingPreferences;
    const windows = config.features.dailyMessages.defaultWindows;
    const now = nowOverride ? nowOverride.setZone(tz) : DateTime.now().setZone(tz);
    let next: DateTime | undefined;
    if (!prefs || !prefs.type) {
      // Default: morning
      const start = DateTime.fromFormat(windows.morning.start, 'HH:mm', { zone: tz });
      const end = DateTime.fromFormat(windows.morning.end, 'HH:mm', { zone: tz });
      next = this.randomTimeInWindow(now, start, end, config.features.dailyMessages.fuzzinessMinutes || 30);
    } else if (prefs.type === 'fixed' && prefs.times && prefs.times.length > 0) {
      // Find next fixed time
      next = this.nextFixedTime(now, prefs.times, tz);
    } else if (prefs.type === 'morning' || prefs.type === 'midday' || prefs.type === 'evening') {
      // morning/midday/evening
      const win = windows[prefs.type as 'morning' | 'midday' | 'evening'];
      const start = DateTime.fromFormat(win.start, 'HH:mm', { zone: tz });
      const end = DateTime.fromFormat(win.end, 'HH:mm', { zone: tz });
      // Here fuzziness is prefs.fuzzinessMinutes (from mockSubscriber) or config.features.dailyMessages.fuzzinessMinutes
      const fuzzinessToPass = prefs?.fuzzinessMinutes || config.features.dailyMessages.fuzzinessMinutes || 30;
      next = this.randomTimeInWindow(now, start, end, fuzzinessToPass);
    }
    return next;
  }

  private randomTimeInWindow(now: DateTime, start: DateTime, end: DateTime, fuzziness: number): DateTime {
    // If now is past end, schedule for next day
    if (now > end) {
      start = start.plus({ days: 1 });
      end = end.plus({ days: 1 });
    }
    
    const windowMinutes = end.diff(start, 'minutes').minutes;
    const randomOffset = Math.floor(Math.random() * windowMinutes);
    const base = start.plus({ minutes: randomOffset });
    
    // Add fuzziness (randomly before/after base)
    const fuzzed = Math.floor(Math.random() * fuzziness * 2) - fuzziness;
    const result = base.plus({ minutes: fuzzed });
    
    // Ensure result is in the future
    if (result <= now) {
      return now.plus({ hours: 24 }); // Schedule for tomorrow at the same time
    }
    
    return result;
  }

  private nextFixedTime(now: DateTime, times: string[], tz: string): DateTime {
    // times: ["08:00", "18:30"]
    const todayTimes = times.map(t => DateTime.fromFormat(t, 'HH:mm', { zone: tz, setZone: true }).set({ year: now.year, month: now.month, day: now.day }));
    const future = todayTimes.find(dt => dt > now);
    if (future) return future;
    const tomorrow = now.plus({ days: 1 });
    return DateTime.fromFormat(times[0], 'HH:mm', { zone: tz, setZone: true }).set({ year: tomorrow.year, month: tomorrow.month, day: tomorrow.day });
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
