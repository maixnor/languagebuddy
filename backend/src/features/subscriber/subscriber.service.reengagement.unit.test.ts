import { SubscriberService } from './subscriber.service';
import { DatabaseService } from '../../core/database';
import { Subscriber } from './subscriber.types';
import { DateTime } from 'luxon';

// Mock DatabaseService
const mockDbService = {
  getDb: jest.fn(),
} as unknown as DatabaseService;

describe('SubscriberService - Re-engagement Logic', () => {
  let subscriberService: SubscriberService;

  beforeAll(() => {
    // Reset instance to ensure clean slate
    (SubscriberService as any).instance = undefined;
    subscriberService = SubscriberService.getInstance(mockDbService);
  });

  const createSubscriber = (lastMessageSentAt?: Date): Subscriber => ({
    connections: { phone: "+1234567890" },
    profile: {
      name: "Test User",
      speakingLanguages: [],
      learningLanguages: [{ languageName: "Spanish", overallLevel: "A1" } as any],
    },
    metadata: {
      digests: [],
      personality: "friendly",
      streakData: { currentStreak: 0, longestStreak: 0, lastIncrement: new Date() },
      mistakeTolerance: "normal"
    },
    isPremium: false,
    lastMessageSentAt,
  } as Subscriber);

  it('should return standard prompt for active users (0 days inactive)', () => {
    const sub = createSubscriber(new Date()); // Active today
    const prompt = subscriberService.getDailySystemPrompt(sub);
    
    expect(prompt).toContain("TASK: INITIATE NEW DAY CONVERSATION");
    expect(prompt).not.toContain("TASK: RE-ENGAGEMENT");
  });

  it('should return standard prompt for users inactive for 1 day', () => {
    const lastSent = DateTime.now().minus({ days: 1 }).toJSDate();
    const sub = createSubscriber(lastSent);
    const prompt = subscriberService.getDailySystemPrompt(sub);

    expect(prompt).toContain("TASK: INITIATE NEW DAY CONVERSATION");
    expect(prompt).not.toContain("TASK: RE-ENGAGEMENT");
  });

  it('should return standard prompt for users inactive for 2 days', () => {
    const lastSent = DateTime.now().minus({ days: 2 }).toJSDate();
    const sub = createSubscriber(lastSent);
    const prompt = subscriberService.getDailySystemPrompt(sub);

    expect(prompt).toContain("TASK: INITIATE NEW DAY CONVERSATION");
    expect(prompt).not.toContain("TASK: RE-ENGAGEMENT");
  });

  it('should return RE-ENGAGEMENT prompt for users inactive for 3 days', () => {
    const lastSent = DateTime.now().minus({ days: 3 }).toJSDate();
    const sub = createSubscriber(lastSent);
    const prompt = subscriberService.getDailySystemPrompt(sub);

    expect(prompt).not.toContain("TASK: INITIATE NEW DAY CONVERSATION");
    expect(prompt).toContain("TASK: RE-ENGAGEMENT");
    expect(prompt).toContain("USER HAS BEEN INACTIVE FOR 3 DAYS");
    expect(prompt).toContain("GOAL: Get a response");
  });

  it('should return standard prompt for users inactive for 4 days', () => {
    const lastSent = DateTime.now().minus({ days: 4 }).toJSDate();
    const sub = createSubscriber(lastSent);
    const prompt = subscriberService.getDailySystemPrompt(sub);

    expect(prompt).toContain("TASK: INITIATE NEW DAY CONVERSATION");
    expect(prompt).not.toContain("TASK: RE-ENGAGEMENT");
  });

  it('should return RE-ENGAGEMENT prompt for users inactive for 6 days', () => {
    const lastSent = DateTime.now().minus({ days: 6 }).toJSDate();
    const sub = createSubscriber(lastSent);
    const prompt = subscriberService.getDailySystemPrompt(sub);

    expect(prompt).toContain("TASK: RE-ENGAGEMENT");
    expect(prompt).toContain("USER HAS BEEN INACTIVE FOR 6 DAYS");
  });

   it('should return standard prompt if lastMessageSentAt is undefined', () => {
    const sub = createSubscriber(undefined);
    const prompt = subscriberService.getDailySystemPrompt(sub);

    expect(prompt).toContain("TASK: INITIATE NEW DAY CONVERSATION");
    expect(prompt).not.toContain("TASK: RE-ENGAGEMENT");
  });
});
