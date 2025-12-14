
import { SubscriberService } from './subscriber.service';
import Redis from 'ioredis';

// Mock Redis
const mockRedisData = new Map<string, string>();
const mockRedis = {
  get: jest.fn((key) => Promise.resolve(mockRedisData.get(key) || null)),
  set: jest.fn((key, value) => {
    mockRedisData.set(key, value as string);
    return Promise.resolve('OK');
  }),
  keys: jest.fn((pattern) => {
      // simplistic match
      const prefix = pattern.replace('*', '');
      return Promise.resolve(Array.from(mockRedisData.keys()).filter(k => k.startsWith(prefix)));
  }),
  eval: jest.fn(() => Promise.resolve(1)), // Mock atomic increment success
} as unknown as Redis;

describe('Subscriber Service Hydration', () => {
  let service: SubscriberService;

  beforeAll(() => {
     // Reset singleton
    (SubscriberService as any).instance = undefined;
    service = SubscriberService.getInstance(mockRedis);
  });
  
  afterEach(() => {
     mockRedisData.clear();
     jest.clearAllMocks();
  });

  it('should hydrate Date objects when fetching from Redis', async () => {
    const phone = '+1234567890';
    const now = new Date();
    
    // 1. Create a subscriber (which saves it to Redis as JSON string)
    const created = await service.createSubscriber(phone, {
        signedUpAt: now,
        lastActiveAt: now,
        nextPushMessageAt: now
    });
    
    // 2. Fetch it back
    const fetched = await service.getSubscriber(phone);
    
    // 3. Verify Dates are actual Date objects, not strings
    expect(fetched).not.toBeNull();
    if (fetched) {
        expect(fetched.signedUpAt).toBeInstanceOf(Date);
        // Precision loss with JSON stringify (milliseconds)
        expect(fetched.signedUpAt?.toISOString()).toBe(now.toISOString());
        
        expect(fetched.lastActiveAt).toBeInstanceOf(Date);
        expect(fetched.nextPushMessageAt).toBeInstanceOf(Date);
    }
  });

    it('should hydrate nested Date objects in languages', async () => {
    const phone = '+1234567890';
    const now = new Date();
    
    const subscriber = await service.createSubscriber(phone);
    
    // Manually add a language with deficiencies
    subscriber.profile.learningLanguages = [{
        languageName: 'Spanish',
        overallLevel: 'A1',
        skillAssessments: [],
        deficiencies: [{
            category: 'grammar',
            specificArea: 'verbs',
            severity: 'moderate',
            frequency: 10,
            examples: [],
            improvementSuggestions: [],
            firstDetected: now,
            lastOccurrence: now,
            lastPracticedAt: now
        }],
        firstEncountered: now,
        lastPracticed: now,
        totalPracticeTime: 0,
        confidenceScore: 0,
        currentLanguage: true
    }];
    
    // Save it (this calls JSON.stringify)
    await service.updateSubscriber(phone, { profile: subscriber.profile });
    
    // Fetch it back
    const fetched = await service.getSubscriber(phone);
    
    expect(fetched).not.toBeNull();
    const deficiency = fetched?.profile.learningLanguages[0].deficiencies[0];
    
    expect(deficiency?.firstDetected).toBeInstanceOf(Date);
    expect(deficiency?.lastOccurrence).toBeInstanceOf(Date);
    expect(deficiency?.lastPracticedAt).toBeInstanceOf(Date);
    expect(deficiency?.lastPracticedAt?.toISOString()).toBe(now.toISOString());
  });
});
