import Redis from 'ioredis';
import { ChatOpenAI } from "@langchain/openai";
import { LanguageBuddyAgent } from '../agents/language-buddy-agent';
import { SubscriberService } from './subscriber-service';
import { OnboardingService } from './onboarding-service';
import { FeedbackService } from './feedback-service';
import { DigestService } from './digest-service';
import { StripeService } from './stripe-service';
import { WhatsAppService } from './whatsapp-service';
import { SchedulerService } from './scheduler-service';
import { WhatsappDeduplicationService } from './whatsapp-deduplication-service';
import { RedisCheckpointSaver } from "../persistence/redis-checkpointer";
import { logger, config } from '../config';
import { initializeSubscriberTools } from "../tools/subscriber-tools";
import { initializeFeedbackTools } from "../tools/feedback-tools";

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

    this.whatsappService = WhatsAppService.getInstance();
    this.whatsappService.initialize(config.whatsapp.token!, config.whatsapp.phoneId!);
  }
}
