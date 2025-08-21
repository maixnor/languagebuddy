import * as cron from 'node-cron';
import { logger, config } from '../config';
import { SubscriberService } from '../services/subscriber-service';
import { WhatsAppService } from '../services/whatsapp-service';
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
    logger.info("All schedulers started successfully");
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
        if (!subscriber.nextPushMessageAt) {
          // If not set, schedule blindly for +24h from now
          nextPush = nowUtc.plus({ hours: 24 });
        } else {
          nextPush = DateTime.fromISO(subscriber.nextPushMessageAt, { zone: 'utc' });
          if (!nextPush.isValid) {
            // If invalid, also schedule +24h from now
            nextPush = nowUtc.plus({ hours: 24 });
          }
        }
        if (nowUtc < nextPush) continue;
        // Send message
        try {
          const message = await this.languageBuddyAgent.initiateConversation(
            subscriber,
            this.subscriberService.getDailySystemPrompt(subscriber),
            ""
          );
          await this.whatsappService.sendMessage(subscriber.connections.phone, message);
          logger.trace({ phoneNumber: subscriber.connections.phone }, "Push message sent");
          // Schedule next message
          const nextTime = this.calculateNextPushTime(subscriber);
          await this.subscriberService.updateSubscriber(subscriber.connections.phone, { nextPushMessageAt: nextTime ? nextTime.toUTC().toISO() || undefined : undefined });
        } catch (error) {
          logger.error({ err: error, phoneNumber: subscriber.connections.phone }, "Error sending push message to subscriber");
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
    if (now > end) start = start.plus({ days: 1 }), end = end.plus({ days: 1 });
    const windowMinutes = end.diff(start, 'minutes').minutes;
    const randomOffset = Math.floor(Math.random() * (windowMinutes - fuzziness));
    const base = start.plus({ minutes: randomOffset });
    // Add fuzziness (randomly before/after base)
    const fuzz = Math.floor(Math.random() * fuzziness) - Math.floor(fuzziness / 2);
    return base.plus({ minutes: fuzz });
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