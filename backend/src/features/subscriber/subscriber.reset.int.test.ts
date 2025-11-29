import { Redis } from 'ioredis';
import { DateTime } from 'luxon';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { mock } from 'jest-mock-extended';

import { Subscriber } from '../../types';
import { SubscriberService } from './subscriber.service';
import { LanguageBuddyAgent } from '../../agents/language-buddy-agent';
import { RedisCheckpointSaver } from '../../persistence/redis-checkpointer';
import { SchedulerService } from '../scheduling/scheduler.service';
import { WhatsAppService } from '../../core/messaging/whatsapp/whatsapp.service';
import { DigestService } from '../digest/digest.service';




describe('Conversation Reset Integration', () => {
  let mockRedis: Redis;
  let subscriberService: SubscriberService;
  let redisCheckpointer: RedisCheckpointSaver;
  let languageBuddyAgent: LanguageBuddyAgent;
  let whatsappService: WhatsAppService;
  let digestService: DigestService;
  let schedulerService: SchedulerService;

  const mockPhoneNumber = '1234567890';
  let mockSubscriber: Subscriber;

  beforeEach(async () => {
    mockRedis = mock<Redis>();
    // Mock Redis methods used by checkpointer and subscriber service
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);

    subscriberService = SubscriberService.getInstance(mockRedis);
    


    redisCheckpointer = new RedisCheckpointSaver(mockRedis);
    languageBuddyAgent = mock<LanguageBuddyAgent>(); // Mock the entire agent
    whatsappService = mock<WhatsAppService>(); // Mock WhatsApp service
    digestService = mock<DigestService>(); // Mock Digest service

    // Mock getInstance for other services to return our mocks
    jest.spyOn(WhatsAppService, 'getInstance').mockReturnValue(whatsappService);
    jest.spyOn(DigestService, 'getInstance').mockReturnValue(digestService);

    // Initialize SchedulerService AFTER all its internal dependencies (WhatsAppService, DigestService) are mocked
    schedulerService = SchedulerService.getInstance(subscriberService, languageBuddyAgent);



    mockSubscriber = {
      connections: { phone: mockPhoneNumber },
      profile: {
        name: 'Test User',
        speakingLanguages: [{ languageName: 'English', overallLevel: 'C1', deficiencies: [], skillAssessments: [], firstEncountered: new Date(), lastPracticed: new Date(), totalPracticeTime: 0, confidenceScore: 0 }],
        learningLanguages: [{ languageName: 'Spanish', overallLevel: 'A1', deficiencies: [], skillAssessments: [], firstEncountered: new Date(), lastPracticed: new Date(), totalPracticeTime: 0, confidenceScore: 0 }],
        timezone: 'UTC',
      },
      metadata: {
        digests: [],
        personality: 'Friendly',
        streakData: { currentStreak: 0, longestStreak: 0, lastIncrement: new Date() },
        predictedChurnRisk: 0,
        engagementScore: 0,
        mistakeTolerance: 'normal',
      },
      signedUpAt: DateTime.now().minus({ days: 10 }).toISO(),
      isPremium: false,
    };

    // Ensure subscriberService.getSubscriber returns our mockSubscriber
    jest.spyOn(subscriberService, 'getSubscriber').mockResolvedValue(mockSubscriber);
    jest.spyOn(subscriberService, 'updateSubscriber').mockResolvedValue(undefined);
    jest.spyOn(subscriberService, 'createDigest').mockResolvedValue(true);
    jest.spyOn(subscriberService, 'incrementConversationCount').mockResolvedValue(undefined);

    // Mock Redis.set for subscriber data
    const subscriberKey = `subscriber:${mockPhoneNumber}`;
    mockRedis.get.mockImplementation((key: string) => {
      if (key === subscriberKey) {
        return Promise.resolve(JSON.stringify(mockSubscriber));
      }
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should clear conversation history and initiate a new one gracefully', async () => {
    // 1. Simulate an initial conversation
    const initialPrompt = "Hello!";
    const initialResponse = "AI response to: " + initialPrompt;
    mockChatOpenAI.invoke.mockImplementationOnce(async () => ({ content: initialResponse }));

    await languageBuddyAgent.processUserMessage(mockSubscriber, initialPrompt);
    
    // Verify a checkpoint was saved
    expect(mockRedis.set).toHaveBeenCalledWith(
      `checkpoint:${mockPhoneNumber}`,
      expect.any(String),
      'EX',
      expect.any(Number)
    );
    mockRedis.set.mockClear(); // Clear mock to count new calls

    // Simulate clearing conversation as part of nightly tasks
    // The executeNightlyTasksForSubscriber method clears and then initiates
    const systemPrompt = subscriberService.getDailySystemPrompt(mockSubscriber);
    const initiatedResponseContent = "Hello! Welcome to your language learning journey."; // From mockChatOpenAI for automated system message

    const result = await schedulerService.executeNightlyTasksForSubscriber(mockSubscriber);

    expect(result).toBe(initiatedResponseContent); // Expect the new initial message

    // Verify checkpoint was deleted
    expect(mockRedis.del).toHaveBeenCalledWith(`checkpoint:${mockPhoneNumber}`);

    // Verify a new conversation was initiated
    expect(mockChatOpenAI.invoke).toHaveBeenCalledWith(
      { messages: [expect.any(SystemMessage), new HumanMessage('')] }, // Expecting system prompt and empty human message
      { configurable: { thread_id: mockPhoneNumber } }
    );
    mockChatOpenAI.invoke.mockClear(); // Clear mock for next interaction

    // 3. Simulate user sending a message AFTER the conversation was cleared and re-initiated
    const userFollowUpMessage = "What's up?";
    const followUpAIResponse = "I'm doing great! How can I help you learn today?"; // From mockChatOpenAI for 'What's up?'
    
    const responseAfterClear = await languageBuddyAgent.processUserMessage(
      mockSubscriber,
      userFollowUpMessage
    );

    expect(responseAfterClear).toBe(followUpAIResponse);
    expect(mockChatOpenAI.invoke).toHaveBeenCalledWith(
      { messages: [expect.any(SystemMessage), expect.any(HumanMessage), expect.any(SystemMessage), new HumanMessage(userFollowUpMessage)] },
      { configurable: { thread_id: mockPhoneNumber } }
    );
  });
});