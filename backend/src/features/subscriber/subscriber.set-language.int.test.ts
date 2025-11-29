import Redis from 'ioredis';
import { SubscriberService } from './subscriber.service';
import { Subscriber } from './subscriber.types';

describe('SubscriberService - setLanguage Integration Tests', () => {
  let redis: Redis;
  let subscriberService: SubscriberService;
  const testPhoneNumber = '+15551234567';

  beforeAll(() => {
    redis = new Redis();
    subscriberService = SubscriberService.getInstance(redis);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.flushdb(); // Clear Redis before each test
    // Create a base subscriber for tests
    await subscriberService.createSubscriber(testPhoneNumber, {
      profile: {
        name: "Test User",
        speakingLanguages: [{
          languageName: "English",
          overallLevel: "C2",
          skillAssessments: [],
          deficiencies: [],
          firstEncountered: new Date(),
          lastPracticed: new Date(),
          totalPracticeTime: 0,
          confidenceScore: 100,
        }],
        learningLanguages: [{
          languageName: "English",
          overallLevel: "B1",
          skillAssessments: [],
          deficiencies: [],
          firstEncountered: new Date(),
          lastPracticed: new Date(),
          totalPracticeTime: 0,
          confidenceScore: 50,
          currentLanguage: true, // Initially learning English
        }],
      }
    });
  });

  describe('Bug 2.4 & 2.5 - setLanguage functionality', () => {
    it('should correctly change the current learning language and update currentLanguage flags', async () => {
      // Set language to Spanish
      await subscriberService.setLanguage(testPhoneNumber, 'Spanish');

      const updatedSubscriber = await subscriberService.getSubscriber(testPhoneNumber);
      expect(updatedSubscriber).toBeDefined();
      expect(updatedSubscriber?.profile.learningLanguages).toHaveLength(2);

      const englishLanguage = updatedSubscriber?.profile.learningLanguages?.find(l => l.languageName === 'English');
      const spanishLanguage = updatedSubscriber?.profile.learningLanguages?.find(l => l.languageName === 'Spanish');

      // English should no longer be current
      expect(englishLanguage?.currentLanguage).toBe(false);
      // Spanish should now be current
      expect(spanishLanguage?.currentLanguage).toBe(true);
    });

    it('should correctly add a new learning language if it does not exist', async () => {
      // Set language to German (new language)
      await subscriberService.setLanguage(testPhoneNumber, 'German');

      const updatedSubscriber = await subscriberService.getSubscriber(testPhoneNumber);
      expect(updatedSubscriber).toBeDefined();
      expect(updatedSubscriber?.profile.learningLanguages).toHaveLength(2); // English + German

      const englishLanguage = updatedSubscriber?.profile.learningLanguages?.find(l => l.languageName === 'English');
      const germanLanguage = updatedSubscriber?.profile.learningLanguages?.find(l => l.languageName === 'German');

      // English should no longer be current
      expect(englishLanguage?.currentLanguage).toBe(false);
      // German should now be current
      expect(germanLanguage).toBeDefined();
      expect(germanLanguage?.currentLanguage).toBe(true);
      expect(germanLanguage?.overallLevel).toBe('A1'); // Default level
    });

    it('should handle setting an already current language without creating duplicates', async () => {
      // Set language to English (already current)
      await subscriberService.setLanguage(testPhoneNumber, 'English');

      const updatedSubscriber = await subscriberService.getSubscriber(testPhoneNumber);
      expect(updatedSubscriber).toBeDefined();
      expect(updatedSubscriber?.profile.learningLanguages).toHaveLength(1); // Should still only have English

      const englishLanguage = updatedSubscriber?.profile.learningLanguages?.find(l => l.languageName === 'English');
      expect(englishLanguage?.currentLanguage).toBe(true); // English should remain current
    });

    it('should handle case-insensitive language codes', async () => {
      // Set language to spanish (lowercase)
      await subscriberService.setLanguage(testPhoneNumber, 'spanish');

      const updatedSubscriber = await subscriberService.getSubscriber(testPhoneNumber);
      expect(updatedSubscriber).toBeDefined();
      expect(updatedSubscriber?.profile.learningLanguages).toHaveLength(2);

      const englishLanguage = updatedSubscriber?.profile.learningLanguages?.find(l => l.languageName === 'English');
      const spanishLanguage = updatedSubscriber?.profile.learningLanguages?.find(l => l.languageName === 'Spanish');

      expect(englishLanguage?.currentLanguage).toBe(false);
      expect(spanishLanguage?.currentLanguage).toBe(true);
    });
  });
});
