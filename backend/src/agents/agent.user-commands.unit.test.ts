import { handleUserCommand } from './agent.user-commands';
import { WhatsAppService } from '../core/messaging/whatsapp';
import { LanguageBuddyAgent } from './language-buddy-agent';
import { Subscriber } from '../features/subscriber/subscriber.types';
import { SubscriberService } from '../features/subscriber/subscriber.service';

// Mock logger
jest.mock('../core/config', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock SubscriberService
const mockDeleteSubscriber = jest.fn();
(SubscriberService.getInstance as jest.Mock) = jest.fn().mockReturnValue({
  deleteSubscriber: mockDeleteSubscriber,
  createDigest: jest.fn(),
});

jest.mock('../features/scheduling/scheduler.service', () => ({
    SchedulerService: {
        getInstance: jest.fn().mockReturnValue({
            executeNightlyTasksForSubscriber: jest.fn()
        })
    }
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
      oneShotMessage: jest.fn(),
      checkLastResponse: jest.fn()
    } as unknown as LanguageBuddyAgent;

    mockSubscriber = {
      connections: { phone: '+1234567890' },
      profile: {
        name: 'Test User',
        timezone: 'UTC',
        speakingLanguages: [{ languageName: 'English', overallLevel: 'C1' }],
        learningLanguages: [],
      },
      isPremium: false,
      signedUpAt: new Date(),
      status: 'active',
      metadata: {
        digests: [],
        personality: 'friendly',
        streakData: { currentStreak: 0, longestStreak: 0, lastIncrement: new Date() },
        predictedChurnRisk: 0,
        engagementScore: 0,
        mistakeTolerance: 'normal'
      }
    } as unknown as Subscriber;

    jest.clearAllMocks();
  });

  it('should call languageBuddyAgent.clearConversation when !clear command is received', async () => {
    const message = '!clear';
    await handleUserCommand(mockSubscriber, message, mockWhatsappService, mockLanguageBuddyAgent);

    expect(mockLanguageBuddyAgent.clearConversation).toHaveBeenCalledWith(mockSubscriber.connections.phone);
    expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(mockSubscriber.connections.phone, 'Conversation history cleared.');
  });

  it('should send a warning when !reset is received and NOT delete subscriber', async () => {
    const message = '!reset';
    const expectedWarning = "Translated Warning Message";
    (mockLanguageBuddyAgent.oneShotMessage as jest.Mock).mockResolvedValue(expectedWarning);

    const result = await handleUserCommand(mockSubscriber, message, mockWhatsappService, mockLanguageBuddyAgent);

    expect(mockLanguageBuddyAgent.oneShotMessage).toHaveBeenCalledWith(
        expect.stringContaining("WARNING"), 
        'English', 
        mockSubscriber.connections.phone
    );
    expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(mockSubscriber.connections.phone, expectedWarning);
    
    // Ensure delete is NOT called
    expect(mockDeleteSubscriber).not.toHaveBeenCalled();
    expect(result).toBe('!reset');
  });

  it('should delete subscriber and send confirmation when !resetreset is received', async () => {
    const message = '!resetreset';
    const expectedGoodbye = "Translated Goodbye Message";
    (mockLanguageBuddyAgent.oneShotMessage as jest.Mock).mockResolvedValue(expectedGoodbye);
    mockDeleteSubscriber.mockResolvedValue(true);

    const result = await handleUserCommand(mockSubscriber, message, mockWhatsappService, mockLanguageBuddyAgent);

    expect(mockLanguageBuddyAgent.clearConversation).toHaveBeenCalledWith(mockSubscriber.connections.phone);
    expect(mockDeleteSubscriber).toHaveBeenCalledWith(mockSubscriber.connections.phone);
    
    expect(mockLanguageBuddyAgent.oneShotMessage).toHaveBeenCalledWith(
        expect.stringContaining("Your account and all data have been permanently deleted"), 
        'English', 
        mockSubscriber.connections.phone
    );
    expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(mockSubscriber.connections.phone, expectedGoodbye);
    expect(result).toBe('!resetreset');
  });
});