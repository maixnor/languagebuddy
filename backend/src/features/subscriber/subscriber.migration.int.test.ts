import { SubscriberService } from './subscriber.service';
import { DatabaseService } from '../../core/database';
import { Subscriber } from './subscriber.types';

describe('SubscriberService (Migration Verification)', () => {
  let subscriberService: SubscriberService;
  let dbService: DatabaseService;
  let phoneNumber: string;

  beforeAll(() => {
    dbService = new DatabaseService(':memory:');
    dbService.migrate();
    (SubscriberService as any).instance = undefined;
    subscriberService = SubscriberService.getInstance(dbService);
  });

  afterAll(() => {
    dbService.close();
  });

  beforeEach(() => {
    dbService.getDb().exec('DELETE FROM subscribers');
    dbService.getDb().exec('DELETE FROM subscriber_languages');
    dbService.getDb().exec('DELETE FROM digests');
    dbService.getDb().exec('DELETE FROM digest_assistant_mistakes');
    phoneNumber = '+15550001111';
  });

  it('should store profile fields in new columns', async () => {
    await subscriberService.createSubscriber(phoneNumber, {
      profile: {
        name: 'Migration Test User',
        timezone: 'Europe/Vienna',
        speakingLanguages: [],
        learningLanguages: []
      },
      isPremium: true
    });

    // Direct DB check
    const row = dbService.getDb().prepare('SELECT name, timezone, is_premium FROM subscribers WHERE phone_number = ?').get(phoneNumber) as any;
    expect(row).toBeDefined();
    expect(row.name).toBe('Migration Test User');
    expect(row.timezone).toBe('Europe/Vienna');
    expect(row.is_premium).toBe(1);
  });

  it('should store languages in subscriber_languages table', async () => {
    await subscriberService.createSubscriber(phoneNumber, {
        profile: {
            name: 'Language User',
            speakingLanguages: [],
            learningLanguages: []
        }
    });

    await subscriberService.setLanguage(phoneNumber, 'German');

    // Direct DB check
    const rows = dbService.getDb().prepare('SELECT language_name, type FROM subscriber_languages WHERE subscriber_phone = ?').all(phoneNumber) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].language_name).toBe('German');
    expect(rows[0].type).toBe('learning');
  });

  it('should store digests in digests table with normalized metrics and mistakes', async () => {
    await subscriberService.createSubscriber(phoneNumber);
    const subscriber = await subscriberService.getSubscriber(phoneNumber);
    if (!subscriber) throw new Error("Subscriber not found");

    // Manually add a digest to metadata (simulating DigestService)
    const digest = {
        timestamp: new Date().toISOString(),
        topic: 'Test Topic',
        summary: 'Test Summary',
        vocabulary: { newWords: ['test'], reviewedWords: [], struggledWith: [], mastered: [] },
        phrases: { newPhrases: [], idioms: [], colloquialisms: [], formalExpressions: [] },
        grammar: { conceptsCovered: [], mistakesMade: [], patternsPracticed: [] },
        conversationMetrics: { 
            messagesExchanged: 10, 
            averageResponseTime: 5.5, 
            topicsDiscussed: ['Weather', 'Sports'], 
            userInitiatedTopics: 1, 
            averageMessageLength: 50, 
            sentenceComplexity: 8, 
            punctuationAccuracy: 90, 
            capitalizationAccuracy: 95, 
            textCoherenceScore: 80, 
            emojiUsage: 0.5, 
            abbreviationUsage: ['lol'] 
        },
        assistantMistakes: [
            { originalText: 'foo', correction: 'bar', reason: 'typo' }
        ]
    };

    subscriber.metadata.digests.push(digest);
    
    // Trigger save (which should sync to digests table)
    await subscriberService.updateSubscriber(phoneNumber, { metadata: subscriber.metadata });

    // 1. Check Digest scalar metrics
    const digestRow = dbService.getDb().prepare(`
        SELECT 
            topic, summary, 
            metric_messages_exchanged, metric_avg_response_time, metric_topics_json 
        FROM digests 
        WHERE subscriber_phone = ?
    `).get(phoneNumber) as any;
    
    expect(digestRow).toBeDefined();
    expect(digestRow.topic).toBe('Test Topic');
    expect(digestRow.metric_messages_exchanged).toBe(10);
    expect(digestRow.metric_avg_response_time).toBe(5.5);
    expect(JSON.parse(digestRow.metric_topics_json)).toEqual(['Weather', 'Sports']);

    // 2. Check Assistant Mistakes (Child Table)
    const mistakesRows = dbService.getDb().prepare(`
        SELECT original_text, correction, reason 
        FROM digest_assistant_mistakes 
        WHERE digest_id = (SELECT id FROM digests WHERE subscriber_phone = ?)
    `).all(phoneNumber) as any[];

    expect(mistakesRows.length).toBe(1);
    expect(mistakesRows[0].original_text).toBe('foo');
    expect(mistakesRows[0].correction).toBe('bar');
    expect(mistakesRows[0].reason).toBe('typo');
  });
});