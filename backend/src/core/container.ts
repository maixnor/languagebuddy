import { StripeWebhookService } from '../features/subscription/subscription-webhook.service';
import { SchedulerService } from '../features/scheduling/scheduler.service';
import { FeedbackService } from '../features/feedback/feedback.service';
import { SubscriptionService } from '../features/subscription/subscription.service';
import Redis from 'ioredis';
import { config, logger } from './config';
import { ChatOpenAI } from '@langchain/openai';
import { SubscriberService } from '../features/subscriber/subscriber.service';
import { OnboardingService } from '../features/onboarding/onboarding.service';
import { WhatsappDeduplicationService } from '../core/messaging/whatsapp/whatsapp-deduplication.service';
import { DigestService } from '../features/digest/digest.service';
import { RedisCheckpointSaver } from '../core/persistence/redis-checkpointer';
import { initializeSubscriberTools } from '../features/subscriber/subscriber.tools';
import { initializeFeedbackTools } from '../tools/feedback-tools';
import { LanguageBuddyAgent } from '../agents/language-buddy-agent';
import { WhatsAppService } from '../core/messaging/whatsapp/whatsapp.service';

export class ServiceContainer {
  public redisClient!: Redis;
  public llm!: ChatOpenAI;
  public languageBuddyAgent!: LanguageBuddyAgent;
  public subscriberService!: SubscriberService;
  public onboardingService!: OnboardingService;
  public feedbackService!: FeedbackService;
  public digestService!: DigestService;
  public subscriptionService!: SubscriptionService; // Renamed from stripeService
  public whatsappService!: WhatsAppService;
  public schedulerService!: SchedulerService;
  public whatsappDeduplicationService!: WhatsappDeduplicationService;
  public stripeWebhookService!: StripeWebhookService;

  async initialize(): Promise<void> {
    this.redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      // tls: {},
    });

    this.redisClient.on('connect', () => {});

    this.redisClient.on('error', (err: any) => {
      logger.error({ err }, 'Redis connection error:');
    });

    this.llm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0.3,
    });

    this.subscriberService = SubscriberService.getInstance(this.redisClient);
    this.onboardingService = OnboardingService.getInstance(this.redisClient);
    this.feedbackService = FeedbackService.getInstance(this.redisClient);
    this.whatsappDeduplicationService = WhatsappDeduplicationService.getInstance(this.redisClient);

    this.digestService = DigestService.getInstance(
      this.llm,
      new RedisCheckpointSaver(this.redisClient),
      this.subscriberService
    );

    initializeSubscriberTools(this.redisClient);
    initializeFeedbackTools(this.redisClient);

    this.languageBuddyAgent = new LanguageBuddyAgent(new RedisCheckpointSaver(this.redisClient), this.llm);

    this.schedulerService = SchedulerService.getInstance(this.subscriberService, this.languageBuddyAgent);
    this.schedulerService.startSchedulers();

    this.subscriptionService = SubscriptionService.getInstance(); // Instantiated as SubscriptionService
    this.subscriptionService.initialize(config.stripe.secretKey!);

    // Instantiate StripeWebhookService
    this.stripeWebhookService = new StripeWebhookService(
      this.subscriberService,
      this.subscriptionService, // Use new subscriptionService
      config.stripe.webhookSecret!
    );

    this.whatsappService = WhatsAppService.getInstance();
    this.whatsappService.initialize(config.whatsapp.token!, config.whatsapp.phoneId!);
  }
}
