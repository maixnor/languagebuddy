import { generateSystemPrompt } from "./system-prompts";
import { Subscriber } from "../features/subscriber/subscriber.types";
import { DateTime } from "luxon";

describe("generateSystemPrompt", () => {
  const mockSubscriber: Subscriber = {
    profile: {
      name: "Test User",
      speakingLanguages: [],
      learningLanguages: [
        {
          languageName: "German",
          overallLevel: "B1",
          skillAssessments: [],
          deficiencies: [],
          firstEncountered: new Date(),
          lastPracticed: new Date(),
          totalPracticeTime: 0,
          confidenceScore: 50,
          isTarget: true,
        },
      ],
      timezone: "America/New_York",
      fluencyLevel: "intermediate",
      areasOfStruggle: ["grammar", "vocabulary"],
      mistakeTolerance: "normal"
    },
    connections: {
      phone: "+1234567890",
    },
    metadata: {
      digests: [],
      personality: "friendly",
      streakData: {
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: new Date(),
      },
      predictedChurnRisk: 0,
      engagementScore: 50,
      difficultyPreference: "adaptive",
    },
    isPremium: false,
    signedUpAt: new Date().toISOString(),
  };

  const createPromptContext = (
    currentLocalTime: DateTime,
    conversationDurationMinutes: number | null = null,
    timeSinceLastMessageMinutes: number | null = null,
    lastDigestTopic: string | null = null
  ) => ({
    subscriber: mockSubscriber,
    conversationDurationMinutes,
    timeSinceLastMessageMinutes,
    currentLocalTime,
    lastDigestTopic,
  });

  it("should generate a basic prompt with subscriber info and current time", () => {
    const now = DateTime.fromISO("2025-01-01T10:00:00.000Z", { zone: "America/New_York" });
    const context = createPromptContext(now);
    const prompt = generateSystemPrompt(context);

    expect(prompt).toContain("You are Maya, an AI language tutor.");
    expect(prompt).toContain("User's target language: German");
    expect(prompt).toContain("User's current fluency level: intermediate");
    expect(prompt).toContain("User's areas of struggle: grammar, vocabulary");
    expect(prompt).toContain(`Current Date and Time (User's Local Time): ${now.toLocaleString(DateTime.DATETIME_FULL)}`);
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

  it("should robustly handle missing areasOfStruggle in profile", () => {
      // Construct a subscriber that matches the runtime shape where the property is missing
      // We cast to any to bypass strict type checking for this regression test
      const subscriberWithoutAreas: any = {
        ...mockSubscriber,
        profile: {
          ...mockSubscriber.profile,
          // explicitly remove areasOfStruggle if it exists in mock, or ensure it's undefined
          areasOfStruggle: undefined
        }
      };
  
      const context = createPromptContext(DateTime.now());
      context.subscriber = subscriberWithoutAreas;
  
      const prompt = generateSystemPrompt(context);
      expect(prompt).toContain("User's areas of struggle: none");
  });
});