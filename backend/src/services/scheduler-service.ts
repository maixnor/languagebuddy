import * as cron from 'node-cron';
import { logger, config } from '../config';
import { SubscriberService } from './subscriber-service';
import { WhatsAppService } from './whatsapp-service';
import { LanguageBuddyAgent } from '../agents/language-buddy-agent';
import { DateTime } from 'luxon';

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
    this.startPushMessageScheduler();
  }

  private startPushMessageScheduler(): void {
    // Run every minute
    cron.schedule('* * * * *', async () => {
      await this.sendPushMessages();
    });
  }

  private async sendPushMessages(): Promise<void> {
    if (config.features.dailyMessages.enabled === false) return;
    try {
      const subscribers = await this.subscriberService.getAllSubscribers();
      const nowUtc = DateTime.utc();
      for (const subscriber of subscribers) {
        let nextPush: DateTime | undefined;
        let shouldSendMessage = false;
        
        if (!subscriber.nextPushMessageAt) {
          // If not set, send message immediately and schedule for +24h from now
          shouldSendMessage = true;
          nextPush = nowUtc.plus({ hours: 24 });
        } else {
          nextPush = DateTime.fromISO(subscriber.nextPushMessageAt, { zone: 'utc' }); // TODO adjust for timezone of user
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
        
        // Send message
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
          
          await this.languageBuddyAgent.clearConversation(subscriber.connections.phone)
          const message = await this.languageBuddyAgent.initiateConversation(
            subscriber,
            this.subscriberService.getDailySystemPrompt(subscriber),
            ""
          );
          
          const messageSent = await this.whatsappService.sendMessage(subscriber.connections.phone, message);
          
          if (messageSent.failed === 0) {
            logger.trace({ 
              phoneNumber: subscriber.connections.phone,
              nextPushTime: finalNextTime.toISO()
            }, "Push message sent successfully");
          } else {
            logger.error({ phoneNumber: subscriber.connections.phone }, "Failed to send push message to subscriber");
            // If message failed, retry in 1 hour
            await this.subscriberService.updateSubscriber(subscriber.connections.phone, { 
              nextPushMessageAt: DateTime.utc().plus({ hours: 1 }).toISO()
            });
          }
        } catch (error) {
          logger.error({ err: error, phoneNumber: subscriber.connections.phone }, "Error sending push message to subscriber");
          // If error occurred, retry in 10 hours
          await this.subscriberService.updateSubscriber(subscriber.connections.phone, { 
            nextPushMessageAt: DateTime.utc().plus({ hours: 10 }).toISO()
          });
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error during push message broadcast");
    }
  }

  public calculateNextPushTime(subscriber: any, nowOverride?: DateTime): DateTime | undefined {
    // Determine user timezone
    let tz = subscriber.profile.timezone || 'UTC';
    // check if the time zone is not just some random string
    if (!DateTime.local().setZone(tz).isValid) {
      logger.warn({ timezone: tz }, "Invalid timezone for subscriber, defaulting to UTC");
      tz = 'UTC';
    }
    const prefs = subscriber.profile.messagingPreferences;
    const windows = config.features.dailyMessages.defaultWindows;
    const now = nowOverride ? nowOverride.setZone(tz) : DateTime.now().setZone(tz);
    let next: DateTime | undefined;
    if (!prefs || !prefs.type) {
      // Default: morning
      const start = DateTime.fromFormat(windows.morning.start, 'HH:mm', { zone: tz });
      const end = DateTime.fromFormat(windows.morning.end, 'HH:mm', { zone: tz });
      next = this.randomTimeInWindow(now, start, end, windows.fuzzinessMinutes);
    } else if (prefs.type === 'fixed' && prefs.times && prefs.times.length > 0) {
      // Find next fixed time
      next = this.nextFixedTime(now, prefs.times, tz);
    } else if (prefs.type === 'morning' || prefs.type === 'midday' || prefs.type === 'evening') {
      // morning/midday/evening
      const win = windows[prefs.type as 'morning' | 'midday' | 'evening'];
      const start = DateTime.fromFormat(win.start, 'HH:mm', { zone: tz });
      const end = DateTime.fromFormat(win.end, 'HH:mm', { zone: tz });
      next = this.randomTimeInWindow(now, start, end, prefs.fuzzinessMinutes || windows.fuzzinessMinutes);
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