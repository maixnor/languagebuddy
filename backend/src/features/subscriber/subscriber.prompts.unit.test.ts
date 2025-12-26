import { generateSystemPrompt } from "./subscriber.prompts";
import { Subscriber } from "./subscriber.types";
import { DateTime } from "luxon";
import { Digest } from "../digest/digest.types";

describe("generateSystemPrompt", () => {
  const mockSubscriber: Subscriber = {
    connections: {
      phone: "+1234567890",
    },
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
        confidenceScore: 100
      }],
      learningLanguages: [
        {
          languageName: "German",
          overallLevel: "B1",
          skillAssessments: [],
          deficiencies: [],
          currentObjectives: ["Learn business German"],
          firstEncountered: new Date(),
          lastPracticed: new Date(),
          totalPracticeTime: 0,
          confidenceScore: 50,
        },
      ],
      timezone: "America/New_York",
    },
    metadata: {
      digests: [],
      personality: "friendly",
      streakData: {
        currentStreak: 0,
        longestStreak: 0,
        lastIncrement: new Date(),
      },
      predictedChurnRisk: 0,
      engagementScore: 50,
      mistakeTolerance: "normal"
    },
    isPremium: false,
    signedUpAt: new Date().toISOString(),
  };

  const createPromptContext = (
    currentLocalTime: DateTime,
    conversationDurationMinutes: number | null = null,
    timeSinceLastMessageMinutes: number | null = null,
    lastDigestTopic: string | null = null,
    subscriberOverride: Partial<Subscriber> | null = null,
    messageCount: number = 0,
    dailyTopic: string | null = null
  ) => ({
    subscriber: subscriberOverride ? { ...mockSubscriber, ...subscriberOverride } : mockSubscriber,
    conversationDurationMinutes,
    timeSinceLastMessageMinutes,
    currentLocalTime,
    lastDigestTopic,
    messageCount,
    dailyTopic
  });

  describe("Steering Logic", () => {
    it("should be in WARM-UP phase when message count is low (<= 3)", () => {
        const now = DateTime.now();
        const context = createPromptContext(now, 5, 1, null, null, 2, "Hiking");
        const prompt = generateSystemPrompt(context);
        
        expect(prompt).toContain("[PHASE: WARM-UP]");
        expect(prompt).not.toContain("[PHASE: STRATEGIC PRACTICE - ACTIVE]");
        // Should not force topic yet
        expect(prompt).not.toContain("DAILY TOPIC: \"Hiking\"");
    });

    it("should switch to STRATEGIC PRACTICE phase when message count is high (> 3)", () => {
        const now = DateTime.now();
        const subscriberWithDeficiency = {
            profile: {
                ...mockSubscriber.profile,
                learningLanguages: [{
                    ...mockSubscriber.profile.learningLanguages[0],
                    deficiencies: [{
                        category: "grammar",
                        specificArea: "past tense",
                        severity: "major",
                        frequency: 10,
                        examples: [],
                        improvementSuggestions: [],
                        firstDetected: new Date(),
                        lastOccurrence: new Date(),
                    } as any]
                }]
            }
        };
        const context = createPromptContext(now, 15, 1, null, subscriberWithDeficiency, 4, "Hiking");
        const prompt = generateSystemPrompt(context);
        
        expect(prompt).not.toContain("[PHASE: WARM-UP]");
        expect(prompt).toContain("[PHASE: STRATEGIC PRACTICE - ACTIVE]");
        expect(prompt).toContain("DAILY TOPIC: \"Hiking\"");
        expect(prompt).toContain("ACTIVELY STEER the conversation");
    });
  });

  it("should generate a basic prompt with subscriber info and current time", () => {
    const now = DateTime.fromISO("2025-01-01T10:00:00.000Z", { zone: "America/New_York" });
    const context = createPromptContext(now);
    const prompt = generateSystemPrompt(context);

    // Check for new Persona format
    expect(prompt).toContain("You are Maya, Test User's personal language learning buddy.");
    expect(prompt).toContain("You're an expat who's lived in their target language region for 5 years.");
    
    // Check for User Profile info
    expect(prompt).toContain("Native language(s): English");
    expect(prompt).toContain("Learning language(s): German at level B1");
    expect(prompt).toContain("Mistake tolerance: normal");
  });

  it("should instruct the agent to ask for missing profile fields (timezone)", () => {
    const now = DateTime.fromISO("2025-01-01T10:00:00.000Z", { zone: "America/New_York" });
    // Create subscriber with missing timezone
    const incompleteSubscriber = {
        ...mockSubscriber.profile,
        timezone: undefined // Simulate missing/invalid timezone
    };
    
    const context = createPromptContext(now, null, null, null, { profile: incompleteSubscriber });

    const prompt = generateSystemPrompt(context);
    
    expect(prompt).toContain("SPECIAL TASK: COLLECT MISSING INFORMATION");
    expect(prompt).toContain("timezone");
    expect(prompt).toContain("PROACTIVELY ask the user for this information");
  });

  it("should include conversation duration when provided", () => {
    const now = DateTime.fromISO("2025-01-01T10:00:00.000Z", { zone: "America/New_York" });
    const context = createPromptContext(now, 45);
    const prompt = generateSystemPrompt(context);
    expect(prompt).toContain("Conversation started 45 minutes ago.");
  });

  describe("time since last message behavior", () => {
    it("should suggest normal rapid conversation for < 5 minutes", () => {
      const now = DateTime.fromISO("2025-01-01T10:00:00.000Z", { zone: "America/New_York" });
      const context = createPromptContext(now, 10, 3);
      const prompt = generateSystemPrompt(context);
      expect(prompt).toContain("Time since last message: 3 minutes.");
      expect(prompt).toContain("Continue the conversation as normal, it's a rapid exchange.");
    });

    it("should suggest acknowledging short break for 5-60 minutes", () => {
      const now = DateTime.fromISO("2025-01-01T10:00:00.000Z", { zone: "America/New_York" });
      const context = createPromptContext(now, 60, 30);
      const prompt = generateSystemPrompt(context);
      expect(prompt).toContain("Time since last message: 30 minutes.");
      expect(prompt).toContain("Acknowledge the short break naturally");
    });

    it("should suggest referencing time gap for 1-6 hours", () => {
      const now = DateTime.fromISO("2025-01-01T10:00:00.000Z", { zone: "America/New_York" });
      const context = createPromptContext(now, 180, 90); // 1.5 hours
      const prompt = generateSystemPrompt(context);
      expect(prompt).toContain("Time since last message: 90 minutes.");
      expect(prompt).toContain("Reference the time gap naturally");
    });

    it("should suggest new conversation day for 6-24 hours", () => {
      const now = DateTime.fromISO("2025-01-01T10:00:00.000Z", { zone: "America/New_York" });
      const context = createPromptContext(now, 720, 480); // 8 hours
      const prompt = generateSystemPrompt(context);
      expect(prompt).toContain("Time since last message: 480 minutes.");
      expect(prompt).toContain("Treat this as a new conversation day. Offer a fresh start.");
    });

    it("should suggest warm welcome back and previous topic for > 24 hours", () => {
      const now = DateTime.fromISO("2025-01-01T10:00:00.000Z", { zone: "America/New_York" });
      const context = createPromptContext(now, 1500, 1445, "German verbs"); // 24 hours + 5 min
      const prompt = generateSystemPrompt(context);
      expect(prompt).toContain("Time since last message: 1445 minutes.");
      expect(prompt).toContain("Offer a warm welcome back. If available, reference the previous topic.");
      expect(prompt).toContain("Previous topic was: \"German verbs\". You can ask if they want to continue or start something new.");
    });
  });

  describe("night-time awareness", () => {
    it("should suggest ending conversation during late night (22:00 local)", () => {
      const now = DateTime.local(2025, 1, 1, 22, 30, { zone: "America/New_York" }); // 10:30 PM local
      const context = createPromptContext(now);
      const prompt = generateSystemPrompt(context);
      expect(prompt).toContain("It is currently late at night/early morning for the user (10:30 PM).");
      expect(prompt).toContain("Suggest ending the conversation naturally soon");
    });

    it("should suggest ending conversation during early morning (02:00 local)", () => {
      const now = DateTime.local(2025, 1, 1, 2, 0, { zone: "America/New_York" }); // 2:00 AM local
      const context = createPromptContext(now);
      const prompt = generateSystemPrompt(context);
      expect(prompt).toContain("It is currently late at night/early morning for the user (02:00 AM).");
      expect(prompt).toContain("Suggest ending the conversation naturally soon");
    });

    it("should not suggest ending conversation during day time (14:00 local)", () => {
      const now = DateTime.fromISO("2025-01-01T14:00:00.000Z", { zone: "America/New_York" }); // 2:00 PM local
      const context = createPromptContext(now);
      const prompt = generateSystemPrompt(context);
      expect(prompt).not.toContain("It is currently late at night/early morning for the user");
      expect(prompt).not.toContain("Suggest ending the conversation naturally soon");
    });
  });

  describe("Assistant Mistakes Logic", () => {
    const createDigest = (timestamp: string, mistakes: any[] = []): Digest => ({
      timestamp,
      topic: "Topic " + timestamp,
      summary: "Summary " + timestamp,
      keyBreakthroughs: [],
      areasOfStruggle: [],
      vocabulary: { newWords: [], reviewedWords: [], struggledWith: [], mastered: [] },
      phrases: { newPhrases: [], idioms: [], colloquialisms: [], formalExpressions: [] },
      grammar: { conceptsCovered: [], mistakesMade: [], patternsPracticed: [] },
      conversationMetrics: {
        messagesExchanged: 10,
        averageResponseTime: 5,
        topicsDiscussed: [],
        userInitiatedTopics: 0,
        averageMessageLength: 50,
        sentenceComplexity: 5,
        punctuationAccuracy: 100,
        capitalizationAccuracy: 100,
        textCoherenceScore: 100,
        emojiUsage: 0,
        abbreviationUsage: []
      },
      assistantMistakes: mistakes,
      userMemos: []
    });
  
    it("should ONLY show ACTION REQUIRED for mistakes in the MOST RECENT digest", () => {
      const d1 = createDigest("2025-01-01T10:00:00Z", [{
          originalText: "Mistake 1",
          correction: "Correction 1",
          reason: "Hallucination"
      }]);
  
      const d2 = createDigest("2025-01-02T10:00:00Z", [{
          originalText: "Mistake 2",
          correction: "Correction 2",
          reason: "Grammar"
      }]);
  
      const d3 = createDigest("2025-01-03T10:00:00Z", []);
  
      const now = DateTime.fromISO("2025-01-03T10:00:00Z");
      const subscriberOverride = {
          metadata: {
              ...mockSubscriber.metadata,
              digests: [d1, d2, d3]
          }
      };
  
      const context = createPromptContext(now, null, null, null, subscriberOverride);
      const prompt = generateSystemPrompt(context);
  
      expect(prompt).toContain("Topic 2025-01-01T10:00:00Z");
      expect(prompt).toContain("Topic 2025-01-02T10:00:00Z");
      expect(prompt).toContain("Topic 2025-01-03T10:00:00Z");
  
      expect(prompt).not.toContain("Mistake 1");
      expect(prompt).not.toContain("Mistake 2");
      expect(prompt).not.toContain("ACTION REQUIRED: At the start of this conversation, apologize");
    });
  
    it("should show ACTION REQUIRED if the MOST RECENT digest has mistakes", () => {
        const d3 = createDigest("2025-01-03T10:00:00Z", [{
            originalText: "Mistake 3",
            correction: "Correction 3",
            reason: "Fact check"
        }]);
    
        const now = DateTime.fromISO("2025-01-03T10:00:00Z");
        const subscriberOverride = {
            metadata: {
                ...mockSubscriber.metadata,
                digests: [d3]
            }
        };
    
        const context = createPromptContext(now, null, null, null, subscriberOverride);
        const prompt = generateSystemPrompt(context);
    
        expect(prompt).toContain("Mistake 3");
        expect(prompt).toContain("ACTION REQUIRED: At the start of this conversation, apologize");
      });
  });
});
