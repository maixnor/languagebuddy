import { generateRegularSystemPrompt } from "../../src/util/system-prompts";
import { Subscriber, Language, LanguageDeficiency } from "../../src/types";

describe("generateRegularSystemPrompt - Deficiency Integration", () => {
  const createSubscriber = (learningLanguages: Language[]): Subscriber => ({
    profile: {
      name: "Test User",
      speakingLanguages: [
        {
          languageName: "English",
          overallLevel: "C2",
          skillAssessments: [],
          deficiencies: [],
          firstEncountered: new Date(),
          lastPracticed: new Date(),
          totalPracticeTime: 0,
          confidenceScore: 100,
        },
      ],
      learningLanguages,
      timezone: "UTC",
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
  });

  const createDeficiency = (
    specificArea: string,
    severity: "minor" | "moderate" | "major",
    category:
      | "grammar"
      | "vocabulary"
      | "comprehension"
      | "cultural-context"
      | "spelling"
      | "syntax",
    lastPracticedAt?: Date,
  ): LanguageDeficiency => ({
    category,
    specificArea,
    severity,
    frequency: 50,
    examples: [`Example mistake for ${specificArea}`],
    improvementSuggestions: [`Practice ${specificArea} regularly`],
    firstDetected: new Date("2024-01-01"),
    lastOccurrence: new Date("2024-01-15"),
    lastPracticedAt,
    practiceCount: lastPracticedAt ? 1 : 0,
  });

  it("should include deficiency section when deficiencies exist", () => {
    const deficiency = createDeficiency(
      "past tense conjugation",
      "major",
      "grammar",
    );
    const language: Language = {
      languageName: "German",
      overallLevel: "B1",
      skillAssessments: [],
      deficiencies: [deficiency],
      firstEncountered: new Date(),
      lastPracticed: new Date(),
      totalPracticeTime: 0,
      confidenceScore: 50,
    };

    const subscriber = createSubscriber([language]);
    const prompt = generateRegularSystemPrompt(subscriber, language);

    expect(prompt).toContain(
      "CURRENT LEARNING FOCUS - AREAS NEEDING IMPROVEMENT",
    );
    expect(prompt).toContain("past tense conjugation");
    expect(prompt).toContain("major severity");
    expect(prompt).toContain("grammar");
  });

  it("should not include deficiency section when no deficiencies exist", () => {
    const language: Language = {
      languageName: "German",
      overallLevel: "B1",
      skillAssessments: [],
      deficiencies: [],
      firstEncountered: new Date(),
      lastPracticed: new Date(),
      totalPracticeTime: 0,
      confidenceScore: 50,
    };

    const subscriber = createSubscriber([language]);
    const prompt = generateRegularSystemPrompt(subscriber, language);

    expect(prompt).not.toContain("CURRENT LEARNING FOCUS");
  });

  it("should include top 3 deficiencies sorted by priority", () => {
    const deficiencies = [
      createDeficiency("minor issue", "minor", "spelling"),
      createDeficiency("major issue", "major", "grammar"),
      createDeficiency("moderate issue", "moderate", "vocabulary"),
      createDeficiency("another major", "major", "syntax"),
      createDeficiency("another minor", "minor", "punctuation"),
    ];

    const language: Language = {
      languageName: "German",
      overallLevel: "B1",
      skillAssessments: [],
      deficiencies,
      firstEncountered: new Date(),
      lastPracticed: new Date(),
      totalPracticeTime: 0,
      confidenceScore: 50,
    };

    const subscriber = createSubscriber([language]);
    const prompt = generateRegularSystemPrompt(subscriber, language);

    // Should include major deficiencies
    expect(prompt).toContain("major issue");
    expect(prompt).toContain("another major");

    // Minor issues should not appear (only top 3)
    const deficiencySection = prompt.split("CURRENT LEARNING FOCUS")[1];
    const minorCount = (deficiencySection?.match(/minor issue/g) || []).length;
    expect(minorCount).toBe(0);
  });

  it("should show practice status for each deficiency", () => {
    const practicedDeficiency = createDeficiency(
      "practiced area",
      "major",
      "grammar",
      new Date("2024-01-10"),
    );
    const unpracticedDeficiency = createDeficiency(
      "unpracticed area",
      "major",
      "vocabulary",
    );

    const language: Language = {
      languageName: "German",
      overallLevel: "B1",
      skillAssessments: [],
      deficiencies: [practicedDeficiency, unpracticedDeficiency],
      firstEncountered: new Date(),
      lastPracticed: new Date(),
      totalPracticeTime: 0,
      confidenceScore: 50,
    };

    const subscriber = createSubscriber([language]);
    const prompt = generateRegularSystemPrompt(subscriber, language);

    expect(prompt).toContain("last practiced");
    expect(prompt).toContain("never practiced");
  });

  it("should include examples and improvement suggestions", () => {
    const deficiency = createDeficiency("article usage", "moderate", "grammar");
    deficiency.examples = ['Wrong: "Ich habe Katze"', 'Wrong: "Er ist Lehrer"'];
    deficiency.improvementSuggestions = ["Focus on der/die/das patterns"];

    const language: Language = {
      languageName: "German",
      overallLevel: "B1",
      skillAssessments: [],
      deficiencies: [deficiency],
      firstEncountered: new Date(),
      lastPracticed: new Date(),
      totalPracticeTime: 0,
      confidenceScore: 50,
    };

    const subscriber = createSubscriber([language]);
    const prompt = generateRegularSystemPrompt(subscriber, language);

    expect(prompt).toContain("Examples of struggles");
    expect(prompt).toContain("Improvement approach");
    expect(prompt).toContain("Focus on der/die/das patterns");
  });

  it("should include natural integration instructions", () => {
    const deficiency = createDeficiency("past tense", "major", "grammar");
    const language: Language = {
      languageName: "German",
      overallLevel: "B1",
      skillAssessments: [],
      deficiencies: [deficiency],
      firstEncountered: new Date(),
      lastPracticed: new Date(),
      totalPracticeTime: 0,
      confidenceScore: 50,
    };

    const subscriber = createSubscriber([language]);
    const prompt = generateRegularSystemPrompt(subscriber, language);

    expect(prompt).toContain(
      "Weave these weak areas into the conversation naturally",
    );
    expect(prompt).toContain(
      "Don't explicitly mention you're targeting these areas",
    );
    expect(prompt).toContain("add_language_deficiency tool");
  });

  it("should maintain all original prompt sections", () => {
    const language: Language = {
      languageName: "German",
      overallLevel: "B1",
      skillAssessments: [],
      deficiencies: [],
      firstEncountered: new Date(),
      lastPracticed: new Date(),
      totalPracticeTime: 0,
      confidenceScore: 50,
    };

    const subscriber = createSubscriber([language]);
    const prompt = generateRegularSystemPrompt(subscriber, language);

    // Check original sections still exist
    expect(prompt).toContain("USER PROFILE");
    expect(prompt).toContain("CONVERSATION GUIDELINES");
    expect(prompt).toContain("Test User");
    expect(prompt).toContain("German at level B1");
  });
});

describe("generateRegularSystemPrompt - Mistake Tolerance Integration", () => {
  const createSubscriberWithDigests = (
    digestCount: number,
    mistakeTolerance?: "forgiving" | "normal" | "exact" | "hyperexact",
  ): Subscriber => {
    const digests = Array.from({ length: digestCount }, (_, i) => ({
      topic: `Topic ${i + 1}`,
      summary: `Summary ${i + 1}`,
      timestamp: new Date().toISOString(),
      vocabulary: {},
      grammar: {},
      phrases: {},
    }));

    return {
      profile: {
        name: "Test User",
        speakingLanguages: [
          {
            languageName: "English",
            overallLevel: "C2",
            skillAssessments: [],
            deficiencies: [],
            firstEncountered: new Date(),
          },
        ],
        learningLanguages: [
          {
            languageName: "German",
            overallLevel: "B1",
            skillAssessments: [],
            deficiencies: [],
            firstEncountered: new Date(),
          },
        ],
        timezone: "UTC",
      },
      connections: { phone: "+1234567890" },
      metadata: {
        digests,
        personality: "friendly",
        streakData: {
          currentStreak: 0,
          longestStreak: 0,
          lastActiveDate: new Date(),
        },
        predictedChurnRisk: 0,
        engagementScore: 50,
        difficultyPreference: "adaptive",
        mistakeTolerance,
      },
      isPremium: false,
      signedUpAt: new Date().toISOString(),
    };
  };

  const language: Language = {
    languageName: "German",
    overallLevel: "B1",
    skillAssessments: [],
    deficiencies: [],
    firstEncountered: new Date(),
  };

  it('should default to "normal" mistake tolerance if not set', () => {
    const subscriber = createSubscriberWithDigests(0);
    const prompt = generateRegularSystemPrompt(subscriber, language);
    expect(prompt).toContain("Mistake tolerance: normal");
  });

  it("should include special task to ask for mistake tolerance on the second day (1 digest)", () => {
    const subscriber = createSubscriberWithDigests(1);
    const prompt = generateRegularSystemPrompt(subscriber, language);
    expect(prompt).toContain(
      "SPECIAL TASK: ASK FOR MISTAKE TOLERANCE PREFERENCE",
    );
  });

  it("should not include special task if mistake tolerance is already set", () => {
    const subscriber = createSubscriberWithDigests(1, "forgiving");
    const prompt = generateRegularSystemPrompt(subscriber, language);
    expect(prompt).not.toContain(
      "SPECIAL TASK: ASK FOR MISTAKE TOLERANCE PREFERENCE",
    );
  });

  it("should not include special task if there are more than 1 digest", () => {
    const subscriber = createSubscriberWithDigests(2);
    const prompt = generateRegularSystemPrompt(subscriber, language);
    expect(prompt).not.toContain(
      "SPECIAL TASK: ASK FOR MISTAKE TOLERANCE PREFERENCE",
    );
  });

  it("should not include special task if there are 0 digests", () => {
    const subscriber = createSubscriberWithDigests(0);
    const prompt = generateRegularSystemPrompt(subscriber, language);
    expect(prompt).not.toContain(
      "SPECIAL TASK: ASK FOR MISTAKE TOLERANCE PREFERENCE",
    );
  });

  it("should include forgiving conversation guidelines", () => {
    const subscriber = createSubscriberWithDigests(0, "forgiving");
    const prompt = generateRegularSystemPrompt(subscriber, language);
    expect(prompt).toContain(
      '- "forgiving": Only correct critical mistakes that impede understanding.',
    );
  });

  it("should include normal conversation guidelines", () => {
    const subscriber = createSubscriberWithDigests(0, "normal");
    const prompt = generateRegularSystemPrompt(subscriber, language);
    expect(prompt).toContain(
      '- "normal": Correct common mistakes and errors that affect clarity.',
    );
  });

  it("should include exact conversation guidelines", () => {
    const subscriber = createSubscriberWithDigests(0, "exact");
    const prompt = generateRegularSystemPrompt(subscriber, language);
    expect(prompt).toContain(
      '- "exact": Correct most mistakes, including minor grammatical errors and awkward phrasing.',
    );
  });

  it("should include hyperexact conversation guidelines", () => {
    const subscriber = createSubscriberWithDigests(0, "hyperexact");
    const prompt = generateRegularSystemPrompt(subscriber, language);
    expect(prompt).toContain(
      '- "hyperexact": Correct every single mistake, including minor details, to achieve near-native precision.',
    );
  });
});
