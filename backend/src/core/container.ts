import { StripeWebhookService } from '../features/subscription/subscription-webhook.service';
import { SchedulerService } from '../features/scheduling/scheduler.service';
import { FeedbackService } from '../features/feedback/feedback.service';
import { SubscriptionService } from '../features/subscription/subscription.service';

import { config, logger } from './config';
import { ChatOpenAI } from '@langchain/openai';
import { SubscriberService } from '../features/subscriber/subscriber.service';
import { OnboardingService } from '../features/onboarding/onboarding.service';
import { WhatsappDeduplicationService } from '../core/messaging/whatsapp/whatsapp-deduplication.service';
import { DigestService } from '../features/digest/digest.service';
import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'; // Add BaseCheckpointSaver
import { SqliteCheckpointSaver } from '../core/persistence/sqlite-checkpointer'; // Single import
import { initializeSubscriberTools } from '../features/subscriber/subscriber.tools';

import { LanguageBuddyAgent } from '../agents/language-buddy-agent';
import { WhatsAppService } from '../core/messaging/whatsapp/whatsapp.service';
import { DatabaseService } from './database'; // Added import

export class ServiceContainer {

  public dbService!: DatabaseService; // Declared dbService
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


    this.dbService = new DatabaseService(config.dbPath);

    this.llm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0.3,
    });

    this.subscriberService = SubscriberService.getInstance(this.dbService); // Passed dbService
    this.onboardingService = OnboardingService.getInstance();
    this.feedbackService = FeedbackService.getInstance(this.dbService);
    this.whatsappDeduplicationService = WhatsappDeduplicationService.getInstance(this.dbService);

    this.digestService = DigestService.getInstance(
      this.llm,
      new SqliteCheckpointSaver(this.dbService),
      this.subscriberService
    );

    initializeSubscriberTools(this.dbService);


    this.languageBuddyAgent = new LanguageBuddyAgent(
      new SqliteCheckpointSaver(this.dbService), 
      this.llm, 
      this.digestService, 
      this.feedbackService
    );

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
