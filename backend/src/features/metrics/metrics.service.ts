import { ServiceContainer } from '../../core/container';
import { logger, config } from '../../core/config';
import { 
  totalSubscribers, 
  activeSubscribers24h, 
  activeConversations, 
  inactiveSubscribers3d,
  subscribersPremiumTotal,
  subscribersTrialTotal,
  subscribersFreeThrottledTotal,
  subscriberAnomaliesDetectedHourly,
  redisInconsistenciesDetectedHourly
} from '../../core/observability/metrics';
import { DateTime } from 'luxon';
import { SubscriberService } from '../subscriber/subscriber.service';

export class MetricsService {
  private static instance: MetricsService;
  private services: ServiceContainer;
  private pollingInterval: NodeJS.Timeout | null = null;
  private hourlyQualityPollingInterval: NodeJS.Timeout | null = null;

  private constructor(services: ServiceContainer) {
    this.services = services;
  }

  public static getInstance(services: ServiceContainer): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService(services);
    }
    return MetricsService.instance;
  }

  /**
   * Main function to poll Redis and update Gauges.
   * This operation can be expensive if there are thousands of users,
   * so it should run infrequently (e.g., every 5-10 minutes).
   */
  public async updateSnapshotMetrics(): Promise<void> {
    try {
      const subscribers = await this.services.subscriberService.getAllSubscribers();
      
      const now = DateTime.now();
      
      let countActive24h = 0;
      let countActiveConvos = 0; // Active < 30m
      let countInactive3d = 0;
      let countPremium = 0;
      let countTrial = 0;
      let countFreeThrottled = 0;

      for (const sub of subscribers) {
        if (!sub.lastActiveAt) continue;

        const lastActive = DateTime.fromJSDate(new Date(sub.lastActiveAt));
        const diffMinutes = now.diff(lastActive, 'minutes').minutes;
        const diffHours = now.diff(lastActive, 'hours').hours;
        const diffDays = now.diff(lastActive, 'days').days;

        // Metric 2: Active in last 24h
        if (diffHours <= 24) {
          countActive24h++;
        }

        // Metric 3: Active Conversation (last 30m)
        if (diffMinutes <= 30) {
          countActiveConvos++;
        }

        // Metric 4: Inactive > 3d
        if (diffDays >= 3) {
          countInactive3d++;
        }

        // Metric: Premium Subscribers
        if (sub.isPremium) {
          countPremium++;
        } else {
          // Metric: Trial Subscribers
          const daysSinceSignup = SubscriberService.getInstance().getDaysSinceSignup(sub);
          if (daysSinceSignup < config.subscription.trialDays) {
            countTrial++;
          } else {
            // Metric: Free Throttled Subscribers (out of trial, not premium)
            countFreeThrottled++;
          }
        }
      }

      // Update Gauges
      totalSubscribers.set(subscribers.length);
      activeSubscribers24h.set(countActive24h);
      activeConversations.set(countActiveConvos);
      inactiveSubscribers3d.set(countInactive3d);
      subscribersPremiumTotal.set(countPremium);
      subscribersTrialTotal.set(countTrial);
      subscribersFreeThrottledTotal.set(countFreeThrottled);

      logger.debug({ 
        total: subscribers.length, 
        active24h: countActive24h, 
        activeConvos: countActiveConvos, 
        inactive3d: countInactive3d,
        premium: countPremium,
        trial: countTrial,
        freeThrottled: countFreeThrottled
      }, "Metrics snapshot updated");

    } catch (error) {
      logger.error({ err: error }, "Error updating snapshot metrics");
    }
  }

  /**
   * Calculates and updates quality-related metrics less frequently (e.g., hourly).
   * These might involve more expensive scans or validations.
   */
  public async updateHourlyQualityMetrics(): Promise<void> {
    try {
      logger.debug("Updating hourly quality metrics...");
      let anomaliesCount = 0;
      let inconsistenciesCount = 0;

      // --- Placeholder for Subscriber Anomalies Detection ---
      // In a real scenario, this would involve fetching all subscribers and
      // validating their structure against a Zod schema or checking for
      // missing critical fields. This can be an expensive operation.
      // For now, we'll simulate or keep it at 0.
      const allSubscribers = await this.services.subscriberService.getAllSubscribers();
      for (const sub of allSubscribers) {
          if (!sub.connections?.phone || !sub.profile?.name) { // Basic check for critical fields
              anomaliesCount++;
          }
          // More advanced checks would involve Zod validation:
          // try {
          //     SubscriberSchema.parse(sub);
          // } catch (e) {
          //     anomaliesCount++;
          // }
      }
      subscriberAnomaliesDetectedHourly.set(anomaliesCount);


      // --- Placeholder for Redis Inconsistencies Detection ---
      // This would involve more complex Redis scans, e.g.,
      // - Checking for LangGraph checkpoints without corresponding subscriber records.
      // - Validating checkpoint structure.
      // For now, we'll simulate or keep it at 0.
      const allRedisKeys = await this.services.redisClient.keys('*');
      const checkpointKeys = allRedisKeys.filter(key => key.startsWith('checkpoint:'));
      const subscriberKeys = allRedisKeys.filter(key => key.startsWith('subscriber:'));

      for (const cpKey of checkpointKeys) {
          const phone = cpKey.split(':')[1];
          if (!subscriberKeys.includes(`subscriber:${phone}`)) {
              inconsistenciesCount++;
          }
      }
      redisInconsistenciesDetectedHourly.set(inconsistenciesCount);


      logger.debug({ 
        subscriberAnomalies: anomaliesCount, 
        redisInconsistencies: inconsistenciesCount 
      }, "Hourly quality metrics updated");

    } catch (error) {
      logger.error({ err: error }, "Error updating hourly quality metrics");
    }
  }


  public startScheduler(snapshotIntervalMs: number = 60000, qualityIntervalMs: number = 3600000): void {
    if (this.pollingInterval) return; // Prevent multiple starts
    
    logger.info("Starting Metrics Snapshot Scheduler...");
    this.updateSnapshotMetrics(); // Run immediately on start
    this.pollingInterval = setInterval(() => {
      this.updateSnapshotMetrics();
    }, snapshotIntervalMs);

    logger.info("Starting Metrics Quality Scheduler (hourly)...");
    this.updateHourlyQualityMetrics(); // Run immediately on start
    this.hourlyQualityPollingInterval = setInterval(() => {
      this.updateHourlyQualityMetrics();
    }, qualityIntervalMs);
  }

  public stopScheduler(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.hourlyQualityPollingInterval) {
      clearInterval(this.hourlyQualityPollingInterval);
      this.hourlyQualityPollingInterval = null;
    }
  }
}
