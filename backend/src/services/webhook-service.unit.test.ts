import { WebhookService } from './webhook-service';
import { ServiceContainer } from './service-container';
import { Subscriber } from '../features/subscriber/subscriber.types';
import { generateDefaultSystemPromptForSubscriber } from '../util/system-prompts';

// Mock the ServiceContainer and its services
const mockOnboardingService = {
  isInOnboarding: jest.fn(),
  startOnboarding: jest.fn(),
};

const mockSubscriberService = {
  getSubscriber: jest.fn(),
  createSubscriber: jest.fn(),
};

const mockLanguageBuddyAgent = {
  initiateConversation: jest.fn(),
  processUserMessage: jest.fn(),
  clearConversation: jest.fn(),
  currentlyInActiveConversation: jest.fn(),
  oneShotMessage: jest.fn(),
};

const mockWhatsappService = {
  sendMessage: jest.fn(),
  markMessageAsRead: jest.fn(),
};

const mockWhatsappDeduplicationService = {
  isDuplicateMessage: jest.fn(),
  isThrottled: jest.fn(),
};

const mockStripeService = {
  checkSubscription: jest.fn(),
  getPaymentLink: jest.fn(),
};

const mockServiceContainer: ServiceContainer = {
  onboardingService: mockOnboardingService as any,
  subscriberService: mockSubscriberService as any,
  languageBuddyAgent: mockLanguageBuddyAgent as any,
  whatsappService: mockWhatsappService as any,
  whatsappDeduplicationService: mockWhatsappDeduplicationService as any,
  stripeService: mockStripeService as any,
  digestService: {} as any, // Not used in this test
  schedulingService: {} as any, // Not used in this test
  feedbackService: {} as any, // Not used in this test
  subscriptionService: {} as any, // Not used in this test
};

describe('WebhookService', () => {
  let webhookService: WebhookService;

  beforeEach(() => {
    jest.clearAllMocks();
    webhookService = new WebhookService(mockServiceContainer);
  });

  describe('processTextMessage', () => {
    const mockMessage = {
      from: '1234567890',
      id: 'wamid.test',
      timestamp: '123456789',
      text: { body: 'Hello' },
      type: 'text',
    };

    it('should start new user onboarding if subscriber does not exist and not in onboarding', async () => {
      mockSubscriberService.getSubscriber.mockResolvedValue(null);
      mockOnboardingService.isInOnboarding.mockResolvedValue(false);
      mockLanguageBuddyAgent.initiateConversation.mockResolvedValue('Welcome message');

      const expectedSubscriberForPrompt = {
        connections: { phone: mockMessage.from },
        profile: { name: "", speakingLanguages: [], learningLanguages: [] },
        metadata: {}
      } as Subscriber;
      const expectedSystemPrompt = generateDefaultSystemPromptForSubscriber(expectedSubscriberForPrompt);

      await (webhookService as any).processTextMessage(mockMessage);

      expect(mockOnboardingService.startOnboarding).toHaveBeenCalledWith(mockMessage.from);
      expect(mockLanguageBuddyAgent.initiateConversation).toHaveBeenCalledWith(
        { connections: { phone: mockMessage.from } },
        expectedSystemPrompt,
        mockMessage.text!.body
      );
      expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(mockMessage.from, 'Welcome message');
    });

    // Add more test cases here for other scenarios in processTextMessage if needed
  });
});
