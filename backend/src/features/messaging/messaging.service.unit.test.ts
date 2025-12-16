import { MessagingService } from './messaging.service';
import { ServiceContainer } from '../../core/container';
import { Subscriber } from '../features/subscriber/subscriber.types';
import { generateDefaultSystemPromptForSubscriber } from '../util/system-prompts';
import { generateOnboardingSystemPrompt } from '../onboarding/onboarding.prompts';

// Mock the ServiceContainer and its services
const mockOnboardingService = {
  isInOnboarding: jest.fn(),
  startOnboarding: jest.fn(),
  completeOnboarding: jest.fn(),
};

const mockSubscriberService = {
  getSubscriber: jest.fn(),
  createSubscriber: jest.fn(),
  getDaysSinceSignup: jest.fn().mockReturnValue(10), // Default > trialDays
  shouldThrottle: jest.fn().mockReturnValue(false),
  shouldShowSubscriptionWarning: jest.fn().mockReturnValue(false),
};

const mockLanguageBuddyAgent = {
  initiateConversation: jest.fn(),
  processUserMessage: jest.fn(),
  clearConversation: jest.fn(),
  currentlyInActiveConversation: jest.fn(),
  oneShotMessage: jest.fn(),
  isOnboardingConversation: jest.fn(),
};

const mockWhatsappService = {
  sendMessage: jest.fn(),
  markMessageAsRead: jest.fn(),
};

const mockWhatsappDeduplicationService = {
  recordMessageProcessed: jest.fn(),
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
  subscriptionWebhookService: {} as any,
};

describe('MessagingService', () => {
  let messagingService: MessagingService;

  beforeEach(() => {
    jest.clearAllMocks();
    messagingService = new MessagingService(mockServiceContainer as any);
  });

  describe('handleWebhookMessage', () => {
    const mockRes = {
      sendStatus: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    it('should ignore duplicate messages', async () => {
      const body = {
        entry: [{
          changes: [{
            value: {
              messages: [{
                id: 'msg-id',
                from: '1234567890',
                type: 'text',
                text: { body: 'Hello' }
              }]
            }
          }]
        }]
      };

      mockWhatsappDeduplicationService.recordMessageProcessed.mockResolvedValue(true); // Duplicate

      await messagingService.handleWebhookMessage(body, mockRes);

      expect(mockWhatsappDeduplicationService.recordMessageProcessed).toHaveBeenCalledWith('msg-id', '1234567890');
      expect(mockRes.sendStatus).toHaveBeenCalledWith(200);
      // Should NOT call processTextMessage logic (which would trigger other mocks)
      expect(mockSubscriberService.getSubscriber).not.toHaveBeenCalled();
    });

    it('should process new messages', async () => {
      const body = {
        entry: [{
          changes: [{
            value: {
              messages: [{
                id: 'msg-id',
                from: '1234567890',
                type: 'text',
                text: { body: 'Hello' }
              }]
            }
          }]
        }]
      };

      mockWhatsappDeduplicationService.recordMessageProcessed.mockResolvedValue(false); // Not duplicate
      mockSubscriberService.getSubscriber.mockResolvedValue(null); // Triggers new user logic

      await messagingService.handleWebhookMessage(body, mockRes);

      expect(mockWhatsappDeduplicationService.recordMessageProcessed).toHaveBeenCalledWith('msg-id', '1234567890');
      expect(mockRes.sendStatus).toHaveBeenCalledWith(200);
      // verify it proceeded to processing
      expect(mockLanguageBuddyAgent.currentlyInActiveConversation).toHaveBeenCalled(); 
    });
  });

  describe('processTextMessage', () => {
    const mockMessage = {
      from: '+1234567890',
      id: 'wamid.test',
      timestamp: '123456789',
      text: { body: 'Hello' },
      type: 'text',
    };

    it('should start new user onboarding if subscriber does not exist and not in active conversation', async () => {
      mockSubscriberService.getSubscriber.mockResolvedValue(null);
      mockLanguageBuddyAgent.currentlyInActiveConversation.mockResolvedValue(false);
      mockLanguageBuddyAgent.initiateConversation.mockResolvedValue('Welcome message');

      const expectedSystemPrompt = generateOnboardingSystemPrompt();

      await (messagingService as any).processTextMessage(mockMessage);

      // expect(mockOnboardingService.startOnboarding).toHaveBeenCalledWith(mockMessage.from); // REMOVED
      // Expect the call to include the profile structure to avoid crashes in the agent
      expect(mockLanguageBuddyAgent.initiateConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          connections: { phone: mockMessage.from },
          profile: expect.any(Object)
        }),
        mockMessage.text!.body,
        expectedSystemPrompt,
        { type: 'onboarding' } // Expect metadata
      );
      expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(mockMessage.from, 'Welcome message');
    });

    it('should continue onboarding if subscriber does not exist but is in active conversation', async () => {
      mockSubscriberService.getSubscriber.mockResolvedValue(null);
      mockLanguageBuddyAgent.currentlyInActiveConversation.mockResolvedValue(true);
      mockLanguageBuddyAgent.processUserMessage.mockResolvedValue('Next onboarding step');
      const expectedSystemPrompt = generateOnboardingSystemPrompt();

      await (messagingService as any).processTextMessage(mockMessage);

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

    it('should complete onboarding and initiate new conversation if subscriber exists and is tagged as onboarding conversation', async () => {
      const mockSubscriber = { 
        connections: { phone: mockMessage.from }, 
        profile: { timezone: 'UTC' },
        metadata: {} 
      };
      mockSubscriberService.getSubscriber.mockResolvedValue(mockSubscriber);
      mockLanguageBuddyAgent.isOnboardingConversation.mockResolvedValue(true);
      
      mockLanguageBuddyAgent.initiateConversation.mockResolvedValue('Hello! Ready to chat?');

      await (messagingService as any).processTextMessage(mockMessage);

      // expect(mockOnboardingService.completeOnboarding).toHaveBeenCalledWith(mockMessage.from); // REMOVED
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
        expect.stringContaining('TASK: INITIATE NEW DAY CONVERSATION'), // Partial match for the system prompt
        { type: 'regular' } // Expect metadata
      );

      // 3. Sending the new conversation message
      expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(mockMessage.from, 'Hello! Ready to chat?');
    });

    // Add more test cases here for other scenarios in processTextMessage if needed
  });
});
