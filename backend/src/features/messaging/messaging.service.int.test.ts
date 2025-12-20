import { MessagingService } from './messaging.service';
import { ServiceContainer } from '../../core/container';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { TelegramUpdate } from '../../core/messaging/telegram/telegram.types';
import express from 'express';

// Manually mock handleUserCommand since it's an imported function, not a class method.
// This is required because MessagingService itself does not have a "handleUserCommand" method to mock.
jest.mock('../../agents/agent.user-commands', () => ({
  handleUserCommand: jest.fn(async (_subscriber, message) => {
    if (message.startsWith('!simulate_command')) {
      return '!simulate_command_handled';
    }
    return 'nothing';
  }),
}));
import { handleUserCommand } from '../../agents/agent.user-commands'; // Import the mocked function

describe('MessagingService (Telegram Integration)', () => {
  let messagingService: MessagingService;
  let mockServices: DeepMockProxy<ServiceContainer>;
  let mockResponse: DeepMockProxy<express.Response>;

  beforeEach(() => {
    mockServices = mockDeep<ServiceContainer>();
    // Default mocks for services that MessagingService will call
    mockServices.subscriberService.getSubscriberByTelegramChatId.mockResolvedValue(undefined); // No existing subscriber by default
    mockServices.subscriberService.createSubscriber.mockImplementation(async (phone, initialData) => ({
      connections: { phone, ...initialData?.connections },
      profile: { name: 'New User', speakingLanguages: [], learningLanguages: [], timezone: 'UTC' },
      status: 'onboarding',
      metadata: { digests: [], personality: 'friendly', streakData: { currentStreak: 0, longestStreak: 0, lastIncrement: new Date() }, predictedChurnRisk: 0, engagementScore: 0, mistakeTolerance: 'normal' },
      isPremium: false,
      signedUpAt: new Date(),
    }));
    mockServices.telegramService.sendMessage.mockResolvedValue(true);
    mockServices.languageBuddyAgent.currentlyInActiveConversation.mockResolvedValue(false);
    mockServices.languageBuddyAgent.initiateConversation.mockResolvedValue({
      response: 'Agent init response',
      updatedSubscriber: {} as any
    });

    messagingService = new MessagingService(mockServices);
    mockResponse = mockDeep<express.Response>();
    (handleUserCommand as jest.Mock).mockClear(); // Clear mock calls for handleUserCommand
  });

  describe('handleTelegramWebhookMessage', () => {
    it('should process a valid Telegram update and delegate to handleTelegramConversation', async () => {
      const telegramUpdate: TelegramUpdate = {
        update_id: 12345,
        message: {
          message_id: 1,
          from: { id: 111, is_bot: false, first_name: 'Test', username: 'testuser' },
          chat: { id: 123, type: 'private' },
          date: Date.now(),
          text: 'Hello Telegram!',
        },
      };

      await messagingService.handleTelegramWebhookMessage(telegramUpdate, mockResponse);

      // Expect subscriber creation/retrieval
      expect(mockServices.subscriberService.getSubscriberByTelegramChatId).toHaveBeenCalledWith(123);
      expect(mockServices.subscriberService.createSubscriber).toHaveBeenCalledWith('+123', expect.any(Object));

      // Expect handleUserCommand to be called (if text is not a command)
      expect(handleUserCommand).toHaveBeenCalledWith(
        expect.any(Object), // subscriber
        'Hello Telegram!',  // message text
        expect.any(Object), // telegramMessenger adapter
        mockServices.languageBuddyAgent,
        mockServices.linkService
      );

      // Expect agent to initiate conversation
      expect(mockServices.languageBuddyAgent.currentlyInActiveConversation).toHaveBeenCalled();
      expect(mockServices.languageBuddyAgent.initiateConversation).toHaveBeenCalled();
      expect(mockServices.telegramService.sendMessage).toHaveBeenCalledWith({
        chat_id: 123,
        text: 'Agent init response'
      });
      expect(mockResponse.sendStatus).toHaveBeenCalledWith(200);
    });

    it('should handle errors during processing and send a 400 status', async () => {
      const telegramUpdate: TelegramUpdate = {
        update_id: 12346,
        message: {
          message_id: 2,
          from: { id: 112, is_bot: false, first_name: 'Error', username: 'erroruser' },
          chat: { id: 456, type: 'private' },
          date: Date.now(),
          text: 'Trigger Error!',
        },
      };

      // Mock a service call to throw an error to simulate processing error
      mockServices.subscriberService.getSubscriberByTelegramChatId.mockRejectedValueOnce(new Error('DB Error'));

      await messagingService.handleTelegramWebhookMessage(telegramUpdate, mockResponse);

      expect(mockServices.subscriberService.getSubscriberByTelegramChatId).toHaveBeenCalledWith(456);
      expect(mockResponse.sendStatus).toHaveBeenCalledWith(400);
      expect(mockServices.telegramService.sendMessage).not.toHaveBeenCalled(); // No message sent on error
    });

    it('should not process malformed updates and send 200 status', async () => {
      const telegramUpdate: TelegramUpdate = {
        update_id: 123,
        message: undefined // Malformed: no message
      };

      await messagingService.handleTelegramWebhookMessage(telegramUpdate, mockResponse);

      expect(mockResponse.sendStatus).toHaveBeenCalledWith(200);
      expect(mockServices.subscriberService.getSubscriberByTelegramChatId).not.toHaveBeenCalled();
      expect(handleUserCommand).not.toHaveBeenCalled();
    });

    it('should delegate to handleUserCommand if message is a command', async () => {
      const telegramUpdate: TelegramUpdate = {
        update_id: 12347,
        message: {
          message_id: 3,
          from: { id: 113, is_bot: false, first_name: 'Cmd', username: 'cmduser' },
          chat: { id: 789, type: 'private' },
          date: Date.now(),
          text: '!simulate_command',
        },
      };
      
      mockServices.subscriberService.getSubscriberByTelegramChatId.mockResolvedValue({
        connections: { phone: '+789', telegram: { chatId: 789 } }
      } as any);

      await messagingService.handleTelegramWebhookMessage(telegramUpdate, mockResponse);

      expect(handleUserCommand).toHaveBeenCalledWith(
        expect.any(Object),
        '!simulate_command',
        expect.any(Object),
        mockServices.languageBuddyAgent,
        mockServices.linkService
      );
      expect(mockServices.languageBuddyAgent.initiateConversation).not.toHaveBeenCalled(); // Should not call agent if command handled
      expect(mockResponse.sendStatus).toHaveBeenCalledWith(200);
    });
  });
});