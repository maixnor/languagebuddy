import { handleUserCommand } from './agent.user-commands';
import { WhatsAppService } from '../core/messaging/whatsapp';
import { LanguageBuddyAgent } from './language-buddy-agent';
import { Subscriber } from '../features/subscriber/subscriber.types';
import { RedisClientType } from 'redis';
import { logger } from '../config';

// Mock the logger to prevent actual logging during tests
jest.mock('../config', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('handleUserCommand', () => {
  let mockWhatsappService: WhatsAppService;
  let mockLanguageBuddyAgent: LanguageBuddyAgent;
  let mockSubscriber: Subscriber;

  beforeEach(() => {
    mockWhatsappService = {
      sendMessage: jest.fn(),
    } as unknown as WhatsAppService;

    mockLanguageBuddyAgent = {
      clearConversation: jest.fn(),
    } as unknown as LanguageBuddyAgent;


    mockSubscriber = {
      id: 'sub123',
      connections: { phone: '+1234567890' },
      profile: {
        name: 'Test User',
        timezone: 'UTC',
        speakingLanguages: [],
        learningLanguages: [],
      },
      isPremium: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
      dialogState: null,
      throttling: {
        sentMessageCount: 0,
        isThrottled: false,
        dailyResetAt: new Date(),
      }
    };
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should call languageBuddyAgent.clearConversation when !clear command is received', async () => {
    const message = '!clear';
    await handleUserCommand(mockSubscriber, message, mockWhatsappService, mockLanguageBuddyAgent);

    expect(mockLanguageBuddyAgent.clearConversation).toHaveBeenCalledWith(mockSubscriber.connections.phone);
    expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(mockSubscriber.connections.phone, 'Conversation history cleared.');
  });
});
