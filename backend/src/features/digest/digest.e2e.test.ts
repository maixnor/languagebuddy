import { logger } from '../../core/observability/logging';

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables first
dotenv.config({ path: path.join(__dirname, '../.env') });

// Setup test environment variables if missing
if (!process.env.PUBLIC_BASE_URL) {
  process.env.PUBLIC_BASE_URL = 'https://test.languagebuddy.com';
}

import { SubscriberService } from '../../features/subscriber/subscriber.service';
import { DigestService } from '../../features/digest/digest.service';
import { LanguageBuddyAgent } from '../../agents/language-buddy-agent';
import { Subscriber, Language } from '../../features/subscriber/subscriber.types';
import { Digest } from '../../features/digest/digest.types';
import Database from 'better-sqlite3';
import { DatabaseService } from '../../core/database';
import { SqliteCheckpointSaver } from '../../core/persistence/sqlite-checkpointer';
import { initializeSubscriberTools } from '../subscriber/subscriber.tools';
import { FeedbackService } from '../feedback/feedback.service'; // Import FeedbackService
import { ChatOpenAI } from '@langchain/openai';


// Predefined conversation templates
interface ConversationMessage {
  type: 'ai' | 'human';
  content: string;
  timestamp?: string;
}

interface ConversationTemplate {
  name: string;
  description: string;
  messages: ConversationMessage[];
  expectedInsights?: {
    minVocabularyWords?: number;
    minGrammarConcepts?: number;
    expectedTopicKeywords?: string[];
    expectedMistakes?: string[];
  };
}

const CONVERSATION_TEMPLATES: Record<string, ConversationTemplate> = {
  germanBasicDative: {
    name: 'German Basic Dative',
    description: 'A conversation about weekend plans with dative case correction',
    messages: [
      { type: 'ai', content: 'Hallo! Wie geht es dir heute?' },
      { type: 'human', content: 'Mir geht es gut, danke! Ich möchte über das Wetter sprechen.' },
      { type: 'ai', content: 'Das ist eine gute Idee! Wie ist das Wetter heute?' },
      { type: 'human', content: 'Das Wetter ist schön heute. Die Sonne scheint und es ist warm.' },
      { type: 'ai', content: 'Sehr gut! Kannst du mir sagen, was du am Wochenende machst?' },
      { type: 'human', content: 'Am Wochenende gehe ich in den Park mit meine Freunde. Wir spielen Fußball.' },
      { type: 'ai', content: 'Das klingt toll! Ich habe einen kleinen Fehler bemerkt - es sollte "mit meinen Freunden" sein, nicht "mit meine Freunde".' },
      { type: 'human', content: 'Oh, danke für die Korrektur! Mit meinen Freunden. Das ist der Dativ, oder?' },
      { type: 'ai', content: 'Genau richtig! Der Dativ ist wichtig im Deutschen. Kannst du mir noch einen Satz mit dem Dativ geben?' },
      { type: 'human', content: 'Ich gebe dem Mann ein Buch. Ist das richtig?' },
      { type: 'ai', content: 'Perfekt! Du verstehst den Dativ sehr gut. Das war eine ausgezeichnete Übung.' },
      { type: 'human', content: 'Vielen Dank! Ich denke, ich werde mehr über deutsche Grammatik lernen.' }
    ],
    expectedInsights: {
      minGrammarConcepts: 1,
      expectedTopicKeywords: ['weather', 'weekend', 'dative'],
      expectedMistakes: ['dative']
    }
  },
  
  germanVocabularyFood: {
    name: 'German Food Vocabulary',
    description: 'A conversation about food preferences to build vocabulary',
    messages: [
      { type: 'ai', content: 'Was ist dein Lieblingsessen?' },
      { type: 'human', content: 'Ich mag Pizza und Pasta sehr gern. Und du?' },
      { type: 'ai', content: 'Ich mag deutsche Küche! Kennst du Sauerbraten oder Schnitzel?' },
      { type: 'human', content: 'Schnitzel kenne ich, aber was ist Sauerbraten?' },
      { type: 'ai', content: 'Sauerbraten ist ein traditionelles deutsches Gericht mit mariniertem Rindfleisch.' },
      { type: 'human', content: 'Das klingt interessant! Ich möchte es mal probieren.' },
      { type: 'ai', content: 'Das solltest du! Magst du auch Gemüse? Karotten, Kartoffeln, Brokkoli?' },
      { type: 'human', content: 'Ja, ich esse gern Karotten und Kartoffeln, aber Brokkoli mag ich nicht so gern.' },
      { type: 'ai', content: 'Das ist okay! Jeder hat andere Geschmäcker. Was trinkst du gern?' },
      { type: 'human', content: 'Ich trinke gern Wasser und manchmal Apfelsaft.' }
    ],
    expectedInsights: {
      minVocabularyWords: 5,
      expectedTopicKeywords: ['food', 'cooking', 'preferences']
    }
  },
  
  germanPastTense: {
    name: 'German Past Tense Practice',
    description: 'A conversation practicing past tense (Perfekt) with corrections',
    messages: [
      { type: 'ai', content: 'Was hast du gestern gemacht?' },
      { type: 'human', content: 'Gestern ich bin zur Arbeit gehen.' },
      { type: 'ai', content: 'Fast richtig! Es sollte heißen: "Gestern bin ich zur Arbeit gegangen." Das Perfekt braucht das Partizip "gegangen".' },
      { type: 'human', content: 'Ah, verstehe! Gestern bin ich zur Arbeit gegangen. Und nach der Arbeit habe ich Sport gemacht.' },
      { type: 'ai', content: 'Sehr gut! Das ist perfekt. Was für Sport hast du gemacht?' },
      { type: 'human', content: 'Ich habe Tennis gespielt mit mein Bruder.' },
      { type: 'ai', content: 'Klasse! Kleiner Hinweis: "mit meinem Bruder" - das ist wieder der Dativ.' },
      { type: 'human', content: 'Richtig! Ich habe Tennis mit meinem Bruder gespielt. Wir haben zwei Stunden gespielt.' },
      { type: 'ai', content: 'Wunderbar! Du lernst sehr schnell. Hattet ihr Spaß?' },
      { type: 'human', content: 'Ja, wir hatten viel Spaß! Mein Bruder hat gewonnen.' }
    ],
    expectedInsights: {
      minGrammarConcepts: 2,
      expectedTopicKeywords: ['past', 'activities', 'sports'],
      expectedMistakes: ['past tense', 'dative']
    }
  },
  
  shortConversation: {
    name: 'Short German Greeting',
    description: 'A very short conversation for testing minimal content',
    messages: [
      { type: 'ai', content: 'Hallo!' },
      { type: 'human', content: 'Hallo! Wie geht es dir?' },
      { type: 'ai', content: 'Gut, danke!' }
    ],
    expectedInsights: {
      minVocabularyWords: 0,
      expectedTopicKeywords: ['greeting']
    }
  },
  
  noResponseConversation: {
    name: 'No Response from User',
    description: 'AI initiates conversation but user never responds - should not create digest',
    messages: [
      { type: 'ai', content: 'Hallo! Wie geht es dir heute? Ich bin dein Deutsch-Lernbuddy und freue mich auf unser Gespräch!' }
    ],
    expectedInsights: {
      minVocabularyWords: 0,
      expectedTopicKeywords: [],
    }
  }
};

class DigestTestHelper {
  private phone: string;
  private subscriberService: SubscriberService;
  private digestService: DigestService;
  private agent: LanguageBuddyAgent;
  private checkpointer: SqliteCheckpointSaver; // Corrected type
  private llm: ChatOpenAI;
  private feedbackService: FeedbackService; // Added feedbackService

  constructor(phone: string, db: Database) {
    this.phone = phone;
    
    // Mock DatabaseService for SubscriberService
    const mockDbService = {
      getDb: () => db,
      migrate: jest.fn(), // Mock migrate as it's called during getInstance
    } as any; 
    this.subscriberService = SubscriberService.getInstance(mockDbService);
    
    // Create LLM and checkpointer
    this.llm = new ChatOpenAI({
      model: 'gpt-3.5-turbo',
      temperature: 0.3,
      maxTokens: 1000,
    });
    this.checkpointer = new SqliteCheckpointSaver(mockDbService); // Corrected instantiation
    
    // Initialize digest service
    this.digestService = DigestService.getInstance(this.llm, this.checkpointer, this.subscriberService);
    
    // Initialize feedback service (new dependency for agent)
    this.feedbackService = FeedbackService.getInstance(mockDbService);

    // Create agent
    this.agent = new LanguageBuddyAgent(this.checkpointer, this.llm, this.digestService, this.feedbackService); // Pass feedbackService
  }

  async createGermanLearner(name: string = 'Sarah'): Promise<Subscriber> {
    logger.debug(`[TEST] Creating German learner: ${name}`);
    
    const englishLanguage: Language = {
      languageName: 'English',
      overallLevel: 'C2',
      skillAssessments: [],
      deficiencies: [],
      firstEncountered: new Date(),
      lastPracticed: new Date(),
      totalPracticeTime: 0,
      confidenceScore: 100
    };

    const germanLanguage: Language = {
      languageName: 'German',
      overallLevel: 'A2',
      skillAssessments: [],
      deficiencies: [],
      currentObjectives: ['Learn basic vocabulary', 'Practice verb conjugation', 'Improve pronunciation'],
      firstEncountered: new Date(),
      lastPracticed: new Date(),
      totalPracticeTime: 120,
      confidenceScore: 60
    };

    const subscriber = await this.subscriberService.createSubscriber(this.phone, {
      profile: {
        name,
        speakingLanguages: [englishLanguage],
        learningLanguages: [germanLanguage],
        timezone: 'America/New_York'
      },
      metadata: {
        digests: [],
        personality: 'A friendly and patient language buddy',
        streakData: {
          currentStreak: 5,
          longestStreak: 10,
          lastActiveDate: new Date(),
          lastIncrement: new Date()
        },
        predictedChurnRisk: 20,
        engagementScore: 80,
        difficultyPreference: 'moderate'
      },
      isPremium: true
    });

    logger.debug(`[TEST] Created subscriber: ${subscriber.profile.name}`);
    return subscriber;
  }

  async loadConversation(templateName: string): Promise<ConversationTemplate> {
    const template = CONVERSATION_TEMPLATES[templateName];
    if (!template) {
      throw new Error(`Conversation template '${templateName}' not found`);
    }

    logger.debug(`[TEST] Loading conversation: ${template.name}`);
    
    // Add timestamps to messages if not present
    const messagesWithTimestamps = template.messages.map(msg => ({
      ...msg,
      timestamp: msg.timestamp || new Date().toISOString()
    }));

    // Create mock checkpoint data that matches the expected structure
    const mockCheckpoint = {
      v: 1,
      id: this.phone,
      ts: new Date().toISOString(),
      channel_versions: { messages: 1 },
      versions_seen: { messages: {} },
      pending_sends: [],
      channel_values: {
        messages: messagesWithTimestamps
      }
    };

    const mockMetadata = {
      source: 'input' as const,
      step: messagesWithTimestamps.length,
      writes: {},
      parents: {}
    };

    const config = { configurable: { thread_id: this.phone } };

    // Save the mock conversation state to SQLite
    await this.checkpointer.put(config, mockCheckpoint, mockMetadata);
    
    logger.debug(`[TEST] Loaded conversation '${template.name}' with ${messagesWithTimestamps.length} messages`);
    
    return {
      ...template,
      messages: messagesWithTimestamps
    };
  }

  async verifyConversationLoaded(): Promise<boolean> {
    try {
      const checkpoint = await this.checkpointer.get({ configurable: { thread_id: this.phone } });
      if (!checkpoint) {
        logger.error(`[TEST] No checkpoint found for thread ${this.phone}`);
        return false;
      }
      // BaseCheckpointSaver.get() returns the Checkpoint object directly, not the tuple
      if (!checkpoint.channel_values) {
        logger.error(`[TEST] channel_values missing in checkpoint`, checkpoint);
        return false;
      }
      const messages = checkpoint.channel_values.messages as any[] || [];
      logger.debug(`[TEST] Found ${messages.length} messages in checkpoint`);
      return messages.length > 0;
    } catch (error) {
      logger.error(`[TEST] Error verifying conversation state:`, error);
      return false;
    }
  }

  async createDigest(): Promise<Digest | undefined> {
    logger.debug(`[TEST] Creating conversation digest`);
    
    const subscriber = await this.subscriberService.getSubscriber(this.phone);
    if (!subscriber) throw new Error('Subscriber not found');

    try {
      const digest = await this.digestService.createConversationDigest(subscriber);
      
      if (digest) {
        await this.digestService.saveDigestToSubscriber(subscriber, digest);
        logger.debug(`[TEST] Digest created and saved successfully`);
      } else {
        logger.debug(`[TEST] Digest creation returned undefined`);
      }
      
      return digest;
    } catch (error) {
      logger.error(`[TEST] Error creating digest:`, error);
      throw error;
    }
  }

  async runDigestWorkflow(templateName: string): Promise<{
    subscriber: Subscriber;
    template: ConversationTemplate;
    digest: Digest | undefined;
  }> {
    // Step 1: Create subscriber
    const subscriber = await this.createGermanLearner();
    
    // Step 2: Load conversation
    const template = await this.loadConversation(templateName);
    
    // Step 3: Verify conversation was loaded
    const hasConversation = await this.verifyConversationLoaded();
    if (!hasConversation) {
      throw new Error('Failed to load conversation');
    }
    
    // Step 4: Create digest
    const digest = await this.createDigest();
    
    return { subscriber, template, digest };
  }

  async getSubscriber(): Promise<Subscriber | null> {
    return this.subscriberService.getSubscriber(this.phone);
  }

  async getRecentDigests(limit: number = 10): Promise<Digest[]> {
    return this.digestService.getRecentDigests(this.phone, limit);
  }

  async getUserMemos(limit: number = 10): Promise<string[]> {
    return this.digestService.getUserMemosFromDigests(this.phone, limit);
  }

  async cleanup(): Promise<void> {
    logger.debug(`[TEST] Cleaning up test data for ${this.phone}`);
    
    try {
      const db = this.subscriberService['dbService'].getDb();
      // Clean up SQLite data
      db.exec(`DELETE FROM subscribers WHERE phone_number = '${this.phone}'`);
      db.exec(`DELETE FROM checkpoints WHERE thread_id = '${this.phone}'`);
      db.exec(`DELETE FROM daily_usage WHERE phone_number = '${this.phone}'`);

    } catch (error) {
      logger.error(`[TEST] Cleanup error:`, error);
    }
  }
}

describe('Digest System E2E Test', () => {
  let test: DigestTestHelper;
  const testPhone = '+1234567890999'; // Use a unique numeric test phone number
  let dbService: DatabaseService;

  beforeAll(async () => {
    // SQLite will be initialized in beforeEach for each test
    logger.debug('[TEST] E2E Digest Test Suite Started');
  });

  beforeEach(async () => {
    // Clear singletons
    (SubscriberService as any).instance = null;
    (DigestService as any).instance = null;
    (FeedbackService as any).instance = null;

    // Create an in-memory database service which automatically runs migrations
    dbService = new DatabaseService(':memory:');
    
    test = new DigestTestHelper(testPhone, dbService.getDb());
    
    // Clean up any existing data for this test phone
    await test.cleanup();
  });

  afterEach(async () => {
    // Close the database connection after each test
    if (dbService) {
      dbService.close();
    }
  });

  afterAll(async () => {
    logger.debug('[TEST] E2E Digest Test Suite Finished');
  });

  // Helper to skip tests if OpenAI key is missing
  const runIfOpenAI = process.env.OPENAI_API_KEY ? it : it.skip;

  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️ Skipping Digest E2E tests because OPENAI_API_KEY is not set.');
  }

  runIfOpenAI('should create a complete subscriber profile and generate a digest from German dative conversation', async () => {
    // Run the complete workflow with dative conversation template
    const { subscriber, template, digest } = await test.runDigestWorkflow('germanBasicDative');
    
    // Verify subscriber was created correctly
    expect(subscriber).toBeTruthy();
    expect(subscriber.profile.name).toBe('Sarah');
    expect(subscriber.profile.speakingLanguages).toHaveLength(1);
    expect(subscriber.profile.speakingLanguages[0].languageName).toBe('English');
    expect(subscriber.profile.learningLanguages).toHaveLength(1);
    expect(subscriber.profile.learningLanguages![0].languageName).toBe('German');
    expect(subscriber.profile.learningLanguages![0].overallLevel).toBe('A2');
    
    // Verify conversation template was loaded
    expect(template.name).toBe('German Basic Dative');
    expect(template.messages.length).toBeGreaterThan(5);
    
    // Verify digest was created
    expect(digest).toBeTruthy();
    expect(digest!.timestamp).toBeTruthy();
    expect(digest!.topic).toBeTruthy();
    expect(digest!.summary).toBeTruthy();
    
    // Verify digest structure
    expect(digest!.vocabulary).toBeDefined();
    expect(digest!.phrases).toBeDefined();
    expect(digest!.grammar).toBeDefined();
    expect(digest!.conversationMetrics).toBeDefined();
    
    // Verify the digest was saved to the subscriber
    const updatedSubscriber = await test.getSubscriber();
    expect(updatedSubscriber).toBeTruthy();
    expect(updatedSubscriber!.metadata.digests).toHaveLength(1);
    expect(updatedSubscriber!.metadata.digests[0].timestamp).toBe(digest!.timestamp);
    
    logger.debug('[TEST] Digest created for dative conversation:', {
      topic: digest!.topic,
      summary: digest!.summary,
      vocabularyCount: digest!.vocabulary.newWords.length,
      grammarConcepts: digest!.grammar.conceptsCovered.length
    });
  }, 60000); // 60 second timeout

  runIfOpenAI('should extract learning insights from German food vocabulary conversation', async () => {
    // Run workflow with food vocabulary conversation
    const { subscriber, template, digest } = await test.runDigestWorkflow('germanVocabularyFood');
    
    expect(digest).toBeTruthy();
    expect(template.name).toBe('German Food Vocabulary');
    
    // Verify that digest contains language learning insights
    // Note: Since we're using real LLM, exact values may vary, but structure should be consistent
    expect(typeof digest!.topic).toBe('string');
    expect(typeof digest!.summary).toBe('string');
    expect(Array.isArray(digest!.keyBreakthroughs)).toBe(true);
    expect(Array.isArray(digest!.areasOfStruggle)).toBe(true);
    
    // Verify vocabulary structure
    expect(Array.isArray(digest!.vocabulary.newWords)).toBe(true);
    expect(Array.isArray(digest!.vocabulary.reviewedWords)).toBe(true);
    expect(Array.isArray(digest!.vocabulary.struggledWith)).toBe(true);
    expect(Array.isArray(digest!.vocabulary.mastered)).toBe(true);
    
    // Verify grammar structure
    expect(Array.isArray(digest!.grammar.conceptsCovered)).toBe(true);
    expect(Array.isArray(digest!.grammar.mistakesMade)).toBe(true);
    expect(Array.isArray(digest!.grammar.patternsPracticed)).toBe(true);
    
    // Verify conversation metrics are set
    expect(typeof digest!.conversationMetrics.messagesExchanged).toBe('number');
    expect(digest!.conversationMetrics.messagesExchanged).toBeGreaterThan(0);
    
    logger.debug('[TEST] Food vocabulary digest insights:', {
      keyBreakthroughs: digest!.keyBreakthroughs,
      areasOfStruggle: digest!.areasOfStruggle,
      vocabularyNew: digest!.vocabulary.newWords,
      grammarConcepts: digest!.grammar.conceptsCovered
    });
  }, 60000);

  runIfOpenAI('should update subscriber language profile based on digest insights from past tense conversation', async () => {
    // First, create a subscriber and get baseline data
    const originalSubscriber = await test.createGermanLearner();
    const originalObjectiveCount = originalSubscriber.profile.learningLanguages![0].currentObjectives?.length || 0;
    const originalDeficiencyCount = originalSubscriber.profile.learningLanguages![0].deficiencies?.length || 0;
    
    // Load past tense conversation and create digest
    await test.loadConversation('germanPastTense');
    await test.createDigest();
    
    // Get updated subscriber
    const updatedSubscriber = await test.getSubscriber();
    expect(updatedSubscriber).toBeTruthy();
    
    const learningLanguage = updatedSubscriber!.profile.learningLanguages![0];
    
    // Verify that language profile was updated
    expect(learningLanguage.lastPracticed).toBeDefined();
    // Handle both Date objects and ISO strings (due to JSON serialization)
    const lastPracticedDate = typeof learningLanguage.lastPracticed === 'string' 
      ? new Date(learningLanguage.lastPracticed) 
      : learningLanguage.lastPracticed;
    expect(lastPracticedDate).toBeInstanceOf(Date);
    expect(learningLanguage.totalPracticeTime).toBeGreaterThanOrEqual(originalSubscriber.profile.learningLanguages![0].totalPracticeTime);
    
    // Check if objectives were updated (may vary based on LLM analysis)
    expect(learningLanguage.currentObjectives).toBeDefined();
    expect(learningLanguage.deficiencies).toBeDefined();
    
    logger.debug('[TEST] Language profile updated after past tense conversation:', {
      originalObjectives: originalObjectiveCount,
      updatedObjectives: learningLanguage.currentObjectives?.length,
      originalDeficiencies: originalDeficiencyCount,
      updatedDeficiencies: learningLanguage.deficiencies?.length,
      practiceTime: learningLanguage.totalPracticeTime
    });
  }, 60000);

  runIfOpenAI('should retrieve recent digests and user memos from multiple conversations', async () => {
    // Create test subscriber and run multiple conversation workflows
    await test.createGermanLearner();
    
    // First conversation: dative
    await test.loadConversation('germanBasicDative');
    const digest1 = await test.createDigest();
    expect(digest1).toBeTruthy();
    
    // Simulate a short delay and create another digest with food vocabulary
    await new Promise(resolve => setTimeout(resolve, 1000));
    await test.loadConversation('germanVocabularyFood');
    const digest2 = await test.createDigest();
    expect(digest2).toBeTruthy();
    
    // Retrieve recent digests
    const recentDigests = await test.getRecentDigests(5);
    expect(recentDigests).toHaveLength(2);
    
    // Verify digests are sorted by timestamp (most recent first)
    expect(new Date(recentDigests[0].timestamp).getTime()).toBeGreaterThanOrEqual(
      new Date(recentDigests[1].timestamp).getTime()
    );
    
    // Get user memos
    const userMemos = await test.getUserMemos(10);
    expect(Array.isArray(userMemos)).toBe(true);
    
    logger.debug('[TEST] Recent digests and memos retrieved:', {
      digestCount: recentDigests.length,
      memoCount: userMemos.length,
      latestTopic: recentDigests[0].topic,
      earliestTopic: recentDigests[1].topic
    });
  }, 60000);

  it('should handle empty conversation gracefully', async () => {
    // Create test subscriber without any conversation
    await test.createGermanLearner();
    
    // Try to create digest without conversation
    const digest = await test.createDigest();
    
    // Should return undefined for empty conversation
    expect(digest).toBeUndefined();
    
    // Subscriber should still exist
    const subscriber = await test.getSubscriber();
    expect(subscriber).toBeTruthy();
    expect(subscriber!.metadata.digests).toHaveLength(0);
  }, 30000);

  // Additional focused tests using specific conversation templates
  it('should handle short conversations correctly', async () => {
    const { subscriber, template, digest } = await test.runDigestWorkflow('shortConversation');
    
    expect(template.name).toBe('Short German Greeting');
    expect(template.messages.length).toBe(3);
    
    // Short conversations might not generate meaningful digests, but should not crash
    if (digest) {
      expect(digest.conversationMetrics.messagesExchanged).toBe(3);
      logger.debug('[TEST] Short conversation digest:', {
        topic: digest.topic,
        vocabulary: digest.vocabulary.newWords.length
      });
    } else {
      logger.debug('[TEST] Short conversation correctly returned no digest');
    }
  }, 30000);

  runIfOpenAI('should extract grammar insights from past tense conversation', async () => {
    const { subscriber, template, digest } = await test.runDigestWorkflow('germanPastTense');
    
    expect(template.name).toBe('German Past Tense Practice');
    expect(digest).toBeTruthy();
    
    // This conversation specifically focuses on past tense, so we expect grammar insights
    expect(digest!.grammar.conceptsCovered.length).toBeGreaterThan(0);
    
    logger.debug('[TEST] Past tense conversation analysis:', {
      grammarConcepts: digest!.grammar.conceptsCovered,
      mistakes: digest!.grammar.mistakesMade,
      areasOfStruggle: digest!.areasOfStruggle
    });
  }, 60000);

  runIfOpenAI('should extract vocabulary insights from food conversation', async () => {
    const { subscriber, template, digest } = await test.runDigestWorkflow('germanVocabularyFood');
    
    expect(template.name).toBe('German Food Vocabulary');
    expect(digest).toBeTruthy();
    
    // This conversation focuses on food vocabulary
    const totalVocabulary = digest!.vocabulary.newWords.length + 
                           digest!.vocabulary.reviewedWords.length + 
                           digest!.vocabulary.mastered.length;
    
    expect(totalVocabulary).toBeGreaterThan(0);
    
    logger.debug('[TEST] Food vocabulary conversation analysis:', {
      newWords: digest!.vocabulary.newWords,
      reviewedWords: digest!.vocabulary.reviewedWords,
      topic: digest!.topic
    });
  }, 60000);

  it('should not create digest when user never responds to AI messages', async () => {
    // Run workflow with no-response conversation (only one AI message)
    const { subscriber, template, digest } = await test.runDigestWorkflow('noResponseConversation');
    
    expect(template.name).toBe('No Response from User');
    expect(template.messages.length).toBe(1);
    
    // Verify it's only one AI message with no user interaction
    const humanMessages = template.messages.filter(msg => msg.type === 'human');
    const aiMessages = template.messages.filter(msg => msg.type === 'ai');
    expect(humanMessages.length).toBe(0);
    expect(aiMessages.length).toBe(1);
    
    // Should not create a digest for one-sided conversations
    expect(digest).toBeUndefined();
    
    // Verify subscriber exists but has no digests
    const finalSubscriber = await test.getSubscriber();
    expect(finalSubscriber).toBeTruthy();
    expect(finalSubscriber!.metadata.digests).toHaveLength(0);
    
    logger.debug('[TEST] Single AI message correctly handled:', {
      messageCount: template.messages.length,
      humanMessages: humanMessages.length,
      aiMessages: aiMessages.length,
      digestCreated: !!digest
    });
  }, 30000);
});