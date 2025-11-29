import { StripeWebhookService } from './stripe-webhook-service';
import { SchedulerService } from '../features/scheduling/scheduler.service';

export class ServiceContainer {
  public redisClient!: Redis;
  public llm!: ChatOpenAI;
  public languageBuddyAgent!: LanguageBuddyAgent;
  public subscriberService!: SubscriberService;
  public onboardingService!: OnboardingService;
  public feedbackService!: FeedbackService;
  public digestService!: DigestService;
  public stripeService!: StripeService;
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
      maxTokens: 1000,
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

    this.stripeService = StripeService.getInstance();
    this.stripeService.initialize(config.stripe.secretKey!);

    // Instantiate StripeWebhookService
    this.stripeWebhookService = new StripeWebhookService(
      this.subscriberService,
      this.stripeService,
      config.stripe.webhookSecret!
    );

    this.whatsappService = WhatsAppService.getInstance();
    this.whatsappService.initialize(config.whatsapp.token!, config.whatsapp.phoneId!);
  }
}
