// Temporary import to avoid circular dependency until Digest is moved to its own feature
import { Digest } from "../digest/digest.types";

export interface LanguageSkillAssessment {
  skill:
    | "grammar"
    | "vocabulary"
    | "comprehension"
    | "spelling"
    | "punctuation"
    | "text-coherence";
  level:
    | "beginner"
    | "elementary"
    | "intermediate"
    | "upper-intermediate"
    | "advanced"
    | "proficient";
  confidence: number; // 0-100, AI confidence in this assessment
  lastAssessed: Date;
  evidence: string[]; // Examples or phrases that led to this assessment
}

export interface LanguageDeficiency {
  category:
    | "grammar"
    | "vocabulary"
    | "comprehension"
    | "cultural-context"
    | "spelling"
    | "syntax";
  specificArea: string; // e.g., "past tense", "business vocabulary", "sentence structure"
  severity: "minor" | "moderate" | "major";
  frequency: number; // How often this error occurs (0-100)
  examples: string[]; // User messages demonstrating this deficiency
  improvementSuggestions: string[];
  firstDetected: Date;
  lastOccurrence: Date;
  lastPracticedAt?: Date; // When this deficiency was last targeted in practice
  practiceCount?: number; // Number of times this deficiency has been practiced
}

export interface Language {
  languageName: string;
  dialect?: string;
  overallLevel: "A1" | "A2" | "B1" | "B2" | "C1" | "C2"; // CEFR levels

  // Detailed skill breakdown
  skillAssessments: LanguageSkillAssessment[];

  // Areas needing improvement
  deficiencies: LanguageDeficiency[];

  currentObjectives?: string[]; // Learning objectives and progress
  motivationFactors?: string[]; // What drives them to learn

  // Metadata
  firstEncountered: Date;
  lastPracticed: Date;
  totalPracticeTime: number; // Minutes
  confidenceScore: number; // 0-100, user's confidence in this language
  currentLanguage?: boolean;
}

export interface Subscriber {
  connections: {
    phone: string;
    // discord: string;
    // telegram: string;
    // instagram: string;
  };
  profile: {
    name: string;
    speakingLanguages: Language[];
    learningLanguages: Language[];
    timezone?: string;
    messagingPreferences?: {
      type: "morning" | "midday" | "evening" | "fixed";
      times?: string[]; // for fixed
      fuzzinessMinutes?: number;
    };
    // favoriteColor?: string;
  };
  signedUpAt?: Date;
  metadata: {
    digests: Digest[];
    personality: string;

    streakData: {
      // TODO use
      currentStreak: number; // Days
      longestStreak: number; // Days
      lastIncrement: Date; // used to invalidate streaks
    };
    lastNightlyDigestRun?: Date; // ISO date string of the last time nightly digest tasks were run for this subscriber (local date)

    // AI model insights about user
    // TODO actually use them
    predictedChurnRisk: number; // 0-100, likelihood of stopping
    engagementScore: number; // 0-100, how engaged they are
    mistakeTolerance: "forgiving" | "normal" | "exact" | "hyperexact"; // how picky the buddy will be with mistakes:w
  };
  isPremium?: boolean;
  isTestUser?: boolean;
  lastActiveAt?: Date;
  lastMessageSentAt?: Date;
  nextPushMessageAt?: Date;
}
