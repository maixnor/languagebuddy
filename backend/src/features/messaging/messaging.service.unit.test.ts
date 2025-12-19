import { MessagingService } from './messaging.service';
import { ServiceContainer } from '../../core/container';
import { Subscriber } from '../features/subscriber/subscriber.types';
import { generateDefaultSystemPromptForSubscriber, generateSystemPrompt } from '../subscriber/subscriber.prompts';
import { generateOnboardingSystemPrompt } from '../onboarding/onboarding.prompts';

// Mock the ServiceContainer and its services
const mockOnboardingService = {
  isInOnboarding: jest.fn(),
  startOnboarding: jest.fn(),
  completeOnboarding: jest.fn(),
};

const mockSubscriberService = {
  getSubscriber: jest.fn(),
  createSubscriber: jest.fn().mockResolvedValue({
    connections: { phone: '+1234567890' },
    profile: { timezone: 'UTC' },
    metadata: {},
    status: 'onboarding',
    isPremium: false,
    signedUpAt: new Date()
  }),
  getDaysSinceSignup: jest.fn().mockReturnValue(10), // Default > trialDays
  shouldThrottle: jest.fn().mockReturnValue(false),
  shouldShowSubscriptionWarning: jest.fn().mockReturnValue(false),
  updateSubscriber: jest.fn(),
  canStartConversationToday: jest.fn().mockResolvedValue(true),
  incrementConversationCount: jest.fn(),
  getDailySystemPrompt: jest.fn().mockReturnValue('System Prompt'),
  shouldPromptForSubscription: jest.fn().mockReturnValue(false)
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
};

const mockTelegramService = {
  processUpdate: jest.fn(),
  sendMessage: jest.fn(),
  setWebhook: jest.fn(),
  getMe: jest.fn(),
};

const mockStripeService = {
  checkSubscription: jest.fn(),
  getPaymentLink: jest.fn(),
};

const mockLinkService = {
  generateLinkCode: jest.fn(),
  linkAccounts: jest.fn(),
};

const mockServiceContainer: ServiceContainer = {
  onboardingService: mockOnboardingService as any,
  subscriberService: mockSubscriberService as any,
  languageBuddyAgent: mockLanguageBuddyAgent as any,
  whatsappService: mockWhatsappService as any,
  whatsappDeduplicationService: mockWhatsappDeduplicationService as any,
  telegramService: mockTelegramService as any,
  linkService: mockLinkService as any,
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
    jest.restoreAllMocks(); // Restore mocks to original implementation/state
    messagingService = new MessagingService(mockServiceContainer as any);
    // Add getSubscriberByTelegramChatId mock which was missing
    (mockSubscriberService as any).getSubscriberByTelegramChatId = jest.fn();
  }); // <--- Added missing closing brace


  describe('handleTelegramWebhookMessage', () => {
      const mockRes = {
          sendStatus: jest.fn(),
      };

      it('should create new subscriber if not found and process message', async () => {
          const body = {
              update_id: 12345,
              message: {
                  chat: { id: 999 },
                  text: "Hello Telegram",
                  from: { username: "tg_user" }
              }
          };

          (mockSubscriberService as any).getSubscriberByTelegramChatId.mockResolvedValue(null);
          mockSubscriberService.createSubscriber.mockResolvedValue({
              connections: { phone: '+999', telegram: { chatId: 999, username: '@tg_user' } },
              profile: { timezone: 'UTC' },
              status: 'active'
          });
          mockLanguageBuddyAgent.currentlyInActiveConversation.mockResolvedValue(false);
          mockLanguageBuddyAgent.initiateConversation.mockResolvedValue({
              response: "Telegram Reply",
              updatedSubscriber: {}
          });

          await messagingService.handleTelegramWebhookMessage(body, mockRes);

          expect(mockSubscriberService.createSubscriber).toHaveBeenCalledWith('+999', expect.objectContaining({
              connections: {
                  phone: '+999',
                  telegram: { chatId: 999, username: '@tg_user' }
              }
          }));
          expect(mockLanguageBuddyAgent.initiateConversation).toHaveBeenCalled();
          expect(mockTelegramService.sendMessage).toHaveBeenCalledWith({
              chat_id: 999,
              text: "Telegram Reply"
          });
          expect(mockRes.sendStatus).toHaveBeenCalledWith(200);
      });

      it('should use existing subscriber and update username if changed', async () => {
          const body = {
              update_id: 12345,
              message: {
                  chat: { id: 888 },
                  text: "Hello Again",
                  from: { username: "new_username" }
              }
          };

          const existingSubscriber = {
              connections: { phone: '+888', telegram: { chatId: 888, username: '@old_username' } },
              profile: { timezone: 'UTC' },
              status: 'active'
          };

          (mockSubscriberService as any).getSubscriberByTelegramChatId.mockResolvedValue(existingSubscriber);
          mockLanguageBuddyAgent.currentlyInActiveConversation.mockResolvedValue(true);
          mockLanguageBuddyAgent.processUserMessage.mockResolvedValue({
              response: "Reply Back",
              updatedSubscriber: existingSubscriber
          });

          await messagingService.handleTelegramWebhookMessage(body, mockRes);

          expect(mockSubscriberService.updateSubscriber).toHaveBeenCalledWith('+888', expect.objectContaining({
              connections: expect.objectContaining({
                  telegram: { chatId: 888, username: '@new_username' }
              })
          }));
          expect(mockLanguageBuddyAgent.processUserMessage).toHaveBeenCalled();
          expect(mockTelegramService.sendMessage).toHaveBeenCalledWith({
              chat_id: 888,
              text: "Reply Back"
          });
      });
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

      expect(mockWhatsappDeduplicationService.recordMessageProcessed).toHaveBeenCalledWith('msg-id');
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
      mockSubscriberService.createSubscriber.mockResolvedValue({
        connections: { phone: '+1234567890' },
        profile: { timezone: 'UTC' },
        metadata: {},
        status: 'onboarding',
        isPremium: false,
        signedUpAt: new Date()
      });
      mockLanguageBuddyAgent.initiateConversation.mockResolvedValue({
        response: "Mock onboarding message",
        updatedSubscriber: { 
          connections: { phone: '+1234567890' }, 
          profile: { name: 'Test User', speakingLanguages: [], learningLanguages: [], timezone: 'UTC', }, 
          status: 'onboarding', // Still onboarding
          isPremium: false,
          metadata: { digests: [], personality: 'friendly', streakData: { currentStreak: 0, longestStreak: 0, lastIncrement: new Date() }, predictedChurnRisk: 0, engagementScore: 50, mistakeTolerance: 'normal' },
          signedUpAt: new Date(),
        }
      });
      mockLanguageBuddyAgent.currentlyInActiveConversation.mockResolvedValue(false);


      await messagingService.handleWebhookMessage(body, mockRes);

      expect(mockWhatsappDeduplicationService.recordMessageProcessed).toHaveBeenCalledWith('msg-id');
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
      
      const mockNewSubscriber = { // Create a mock subscriber for the scenario
        connections: { phone: mockMessage.from },
        profile: { name: '', speakingLanguages: [], learningLanguages: [], timezone: undefined },
        metadata: {},
        status: 'onboarding',
        isPremium: false,
        signedUpAt: new Date(),
      };
      mockSubscriberService.createSubscriber.mockResolvedValue(mockNewSubscriber);

      const expectedSystemPrompt = generateOnboardingSystemPrompt(mockNewSubscriber);

      mockLanguageBuddyAgent.initiateConversation.mockResolvedValue({
        response: 'Welcome message',
        updatedSubscriber: { ...mockNewSubscriber, status: 'onboarding' } // Still onboarding
      });

      await (messagingService as any).processTextMessage(mockMessage);

      // expect(mockOnboardingService.startOnboarding).toHaveBeenCalledWith(mockMessage.from); // REMOVED
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

    it('should continue onboarding if subscriber does not exist but is in active conversation', async () => {
      mockSubscriberService.getSubscriber.mockResolvedValue(null);
      mockLanguageBuddyAgent.currentlyInActiveConversation.mockResolvedValue(true);
      
      const mockNewSubscriber = { // Create a mock subscriber for the scenario
        connections: { phone: mockMessage.from },
        profile: { name: '', speakingLanguages: [], learningLanguages: [], timezone: undefined },
        metadata: {},
        status: 'onboarding',
        isPremium: false,
        signedUpAt: new Date(),
      };
      mockSubscriberService.createSubscriber.mockResolvedValue(mockNewSubscriber);

      const expectedSystemPrompt = generateOnboardingSystemPrompt(mockNewSubscriber);

      mockLanguageBuddyAgent.processUserMessage.mockResolvedValue({
        response: 'Next onboarding step', // Expected response
        updatedSubscriber: { ...mockNewSubscriber, status: 'onboarding' } // Still onboarding
      });

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
        profile: { 
          name: 'Test User', 
          speakingLanguages: [], 
          learningLanguages: [], 
          timezone: 'UTC', 
        }, 
        metadata: { digests: [], personality: 'friendly', streakData: { currentStreak: 0, longestStreak: 0, lastIncrement: new Date() }, predictedChurnRisk: 0, engagementScore: 50, mistakeTolerance: 'normal' },
        status: 'onboarding', // This subscriber is initially onboarding
        isPremium: false,
        signedUpAt: new Date(),
      };
      mockSubscriberService.getSubscriber.mockResolvedValue(mockSubscriber);
      mockLanguageBuddyAgent.currentlyInActiveConversation.mockResolvedValue(true); // Assuming it's an active conversation in onboarding phase
      mockLanguageBuddyAgent.isOnboardingConversation.mockResolvedValue(true); // This tells the MessagingService that the conversation is of type 'onboarding'
      
      // Agent response indicating onboarding is complete and subscriber is now active
      mockLanguageBuddyAgent.processUserMessage.mockResolvedValue({ // Assuming processUserMessage is called after first message in onboarding
        response: 'Hello! Ready to chat?',
        updatedSubscriber: { ...mockSubscriber, status: 'active' } // Onboarding complete -> active
      });

      // The MessagingService will call initiateConversation after clearing the checkpoint.
      // This is for the "new conversation initiation" part.
      mockLanguageBuddyAgent.initiateConversation.mockResolvedValue({
        response: 'Hello! Ready to chat?', // The actual message from agent after new convo starts
        updatedSubscriber: { ...mockSubscriber, status: 'active' } // Subscriber is now active
      });
      // Mock getDailySystemPrompt which is used when initiating a new regular conversation
      mockSubscriberService.getDailySystemPrompt.mockReturnValue('TASK: INITIATE NEW DAY CONVERSATION');

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
        expect.objectContaining({ ...mockSubscriber, status: 'active' }), // Expect an object with active status
        'The Conversation is not being initialized by the User, but by an automated System. Start off with a conversation opener in your next message, then continue the conversation.',
        expect.stringContaining('TASK: INITIATE NEW DAY CONVERSATION') // Partial match for the system prompt
      );

      // 3. Sending the new conversation message
      expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(mockMessage.from, 'Hello! Ready to chat?');
    });

    // Add more test cases here for other scenarios in processTextMessage if needed
  });
});
