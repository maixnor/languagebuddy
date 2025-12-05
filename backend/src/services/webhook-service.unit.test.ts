import { WebhookService } from './webhook-service';
import { ServiceContainer } from './service-container';
import { Subscriber } from '../features/subscriber/subscriber.types';
import { generateDefaultSystemPromptForSubscriber } from '../util/system-prompts';
import { generateOnboardingSystemPrompt } from '../features/onboarding/onboarding.prompts';

// Mock the ServiceContainer and its services
const mockOnboardingService = {
  isInOnboarding: jest.fn(),
  startOnboarding: jest.fn(),
  completeOnboarding: jest.fn(),
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

      const expectedSystemPrompt = generateOnboardingSystemPrompt();

      await (webhookService as any).processTextMessage(mockMessage);

      expect(mockOnboardingService.startOnboarding).toHaveBeenCalledWith(mockMessage.from);
      // Expect the call to include the profile structure to avoid crashes in the agent
      expect(mockLanguageBuddyAgent.initiateConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          connections: { phone: mockMessage.from },
          profile: expect.any(Object)
        }),
        mockMessage.text!.body,
        expectedSystemPrompt
      );
      expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(mockMessage.from, 'Welcome message');
    });

    it('should continue onboarding if subscriber does not exist but is in onboarding', async () => {
      mockSubscriberService.getSubscriber.mockResolvedValue(null);
      mockOnboardingService.isInOnboarding.mockResolvedValue(true);
      mockLanguageBuddyAgent.processUserMessage.mockResolvedValue('Next onboarding step');
      const expectedSystemPrompt = generateOnboardingSystemPrompt();

      await (webhookService as any).processTextMessage(mockMessage);

      // Expect the call to include the profile structure to avoid crashes in the agent
      expect(mockLanguageBuddyAgent.processUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          connections: { phone: mockMessage.from },
          profile: expect.any(Object)
        }),
        mockMessage.text!.body,
        expectedSystemPrompt
      );
      expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(mockMessage.from, 'Next onboarding step');
    });

    it('should complete onboarding and initiate new conversation if subscriber exists and is in onboarding', async () => {
      const mockSubscriber = { 
        connections: { phone: mockMessage.from }, 
        profile: { timezone: 'UTC' },
        metadata: {} 
      };
      mockSubscriberService.getSubscriber.mockResolvedValue(mockSubscriber);
      mockOnboardingService.isInOnboarding.mockResolvedValue(true);
      
      mockLanguageBuddyAgent.initiateConversation.mockResolvedValue('Hello! Ready to chat?');

      await (webhookService as any).processTextMessage(mockMessage);

      expect(mockOnboardingService.completeOnboarding).toHaveBeenCalledWith(mockMessage.from);
      expect(mockLanguageBuddyAgent.clearConversation).toHaveBeenCalledWith(mockMessage.from);
      
      // 1. Confirmation message
      expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(
        mockMessage.from, 
        "🎉 Great! Your Language Buddy profile has been successfully created."
      );

      // 2. New conversation initiation
      expect(mockLanguageBuddyAgent.initiateConversation).toHaveBeenCalledWith(
        mockSubscriber,
        'The Conversation is not being initialized by the User, but by an automated System. Start off with a conversation opener in your next message, then continue the conversation.',
        expect.stringContaining('TASK: INITIATE NEW DAY CONVERSATION') // Partial match for the system prompt
      );

      // 3. Sending the new conversation message
      expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(mockMessage.from, 'Hello! Ready to chat?');
    });

    // Add more test cases here for other scenarios in processTextMessage if needed
  });
});
