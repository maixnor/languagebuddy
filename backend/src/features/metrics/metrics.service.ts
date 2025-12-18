import { ServiceContainer } from '../../core/container';
import { logger, config } from '../../core/config';
import { 
  totalSubscribers, 
  activeSubscribers24h, 
  activeConversations, 
  inactiveSubscribers3d,
  subscribersChurnedTotal,
  subscribersPremiumTotal,
  subscribersTrialTotal,
  subscribersFreeThrottledTotal,
  subscriberAnomaliesDetectedHourly
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
   * Main function to poll data sources and update Gauges.
   * This operation can be expensive if there are thousands of users,
   * so it should run infrequently (e.g., every 5-10 minutes).
   */
  public async updateSnapshotMetrics(): Promise<void> {
    try {
      // Use optimized SQL queries to get counts directly
      const total = await this.services.subscriberService.getTotalSubscribersCount();
      const active24h = await this.services.subscriberService.getActiveSubscribers24hCount();
      const activeConvos = await this.services.subscriberService.getActiveConversationsCount();
      const inactive3d = await this.services.subscriberService.getInactiveSubscribersCount(3); // 3 days
      const churned = await this.services.subscriberService.getChurnedSubscribersCount(7); // 7 days
      const premium = await this.services.subscriberService.getPremiumSubscribersCount();
      const trial = await this.services.subscriberService.getTrialSubscribersCount(config.subscription.trialDays);
      const freeThrottled = await this.services.subscriberService.getFreeThrottledSubscribersCount(config.subscription.trialDays);

      // Update Gauges
      totalSubscribers.set(total);
      activeSubscribers24h.set(active24h);
      activeConversations.set(activeConvos);
      inactiveSubscribers3d.set(inactive3d);
      subscribersChurnedTotal.set(churned);
      subscribersPremiumTotal.set(premium);
      subscribersTrialTotal.set(trial);
      subscribersFreeThrottledTotal.set(freeThrottled);

      logger.debug({ 
        total, 
        active24h, 
        activeConvos, 
        inactive3d,
        churned,
        premium,
        trial,
        freeThrottled
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
      const anomaliesCount = await this.services.subscriberService.getAnomalousSubscribersCount();
      subscriberAnomaliesDetectedHourly.set(anomaliesCount);

      logger.debug({ 
        subscriberAnomalies: anomaliesCount, 
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
