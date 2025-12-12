import { ServiceContainer } from '../../core/container';
import { logger } from '../../core/config';
import { 
  totalSubscribers, 
  activeSubscribers24h, 
  activeConversations, 
  inactiveSubscribers3d 
} from '../../core/observability/metrics';
import { DateTime } from 'luxon';

export class MetricsService {
  private static instance: MetricsService;
  private services: ServiceContainer;
  private pollingInterval: NodeJS.Timeout | null = null;

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
      }

      // Update Gauges
      totalSubscribers.set(subscribers.length);
      activeSubscribers24h.set(countActive24h);
      activeConversations.set(countActiveConvos);
      inactiveSubscribers3d.set(countInactive3d);

      logger.debug({ 
        total: subscribers.length, 
        active24h: countActive24h, 
        activeConvos: countActiveConvos, 
        inactive3d: countInactive3d 
      }, "Metrics snapshot updated");

    } catch (error) {
      logger.error({ err: error }, "Error updating snapshot metrics");
    }
  }

  public startScheduler(intervalMs: number = 60000): void {
    if (this.pollingInterval) return;
    
    logger.info("Starting Metrics Scheduler...");
    // Run immediately on start
    this.updateSnapshotMetrics();
    
    this.pollingInterval = setInterval(() => {
      this.updateSnapshotMetrics();
    }, intervalMs);
  }

  public stopScheduler(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}
