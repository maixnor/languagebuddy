
export interface LanguageSkillAssessment {
  skill: 'grammar' | 'vocabulary' | 'comprehension' | 'spelling' | 'punctuation' | 'text-coherence';
  level: 'beginner' | 'elementary' | 'intermediate' | 'upper-intermediate' | 'advanced' | 'proficient';
  confidence: number; // 0-100, AI confidence in this assessment
  lastAssessed: Date;
  evidence: string[]; // Examples or phrases that led to this assessment
}

export interface LanguageDeficiency {
  category: 'grammar' | 'vocabulary' | 'comprehension' | 'cultural-context' | 'spelling' | 'syntax';
  specificArea: string; // e.g., "past tense", "business vocabulary", "sentence structure"
  severity: 'minor' | 'moderate' | 'major';
  frequency: number; // How often this error occurs (0-100)
  examples: string[]; // User messages demonstrating this deficiency
  improvementSuggestions: string[];
  firstDetected: Date;
  lastOccurrence: Date;
}

export interface Language {
  languageName: string;
  dialect?: string;
  overallLevel: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'; // CEFR levels
  
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
}

export interface Subscriber {
  connections: {
    phone: string;
    // discord: string;
    // telegram: string;
    // instagram: string;
  }
  profile: {
    name: string;
    speakingLanguages: Language[];
    learningLanguages: Language[];
    timezone?: string;
    messagingPreferences?: {
      type: 'morning' | 'midday' | 'evening' | 'fixed';
      times?: string[]; // for fixed
    };
    // favoriteColor?: string;
  }
  metadata: {
    digests: Digest[];
    personality: string;
    
    streakData: { // TODO use
      currentStreak: number; // Days
      longestStreak: number;
      lastActiveDate: Date;
    };
    
    // AI model insights about user
    // TODO actually use them
    predictedChurnRisk: number; // 0-100, likelihood of stopping
    engagementScore: number; // 0-100, how engaged they are
    difficultyPreference: 'easy' | 'moderate' | 'challenging' | 'adaptive';
  }
  isPremium?: boolean;
  lastActiveAt?: Date;
  nextPushMessageAt?: string; // ISO string in UTC
}

export interface Digest {
  timestamp: string;
  topic: string;
  summary: string;
  keyBreakthroughs: string[];
  areasOfStruggle: string[];
  
  vocabulary: {
    newWords: string[];
    reviewedWords: string[];
    struggledWith: string[];
    mastered: string[];
  };
  
  phrases: {
    newPhrases: string[];
    idioms: string[];
    colloquialisms: string[];
    formalExpressions: string[];
  };
  
  grammar: {
    conceptsCovered: string[];
    mistakesMade: string[];
    patternsPracticed: string[];
  };
  
  // Conversation quality metrics
  conversationMetrics: {
    messagesExchanged: number;
    averageResponseTime: number; // seconds
    topicsDiscussed: string[];
    userInitiatedTopics: number;
    
    // Text-specific metrics
    averageMessageLength: number; // characters
    sentenceComplexity: number; // average words per sentence
    punctuationAccuracy: number; // percentage
    capitalizationAccuracy: number; // percentage
    textCoherenceScore: number; // 0-100, how well ideas connect
    emojiUsage: number; // frequency of emoji use
    abbreviationUsage: string[]; // common abbreviations used
  };
}

export interface FeedbackEntry {
  timestamp: string;
  originalMessage: string;
  userFeedback: string;
  userPhone: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  actionItems: string[];
  category: 'content' | 'technical' | 'suggestion' | 'other';
}

export interface WebhookMessage {
  id: string;
  from: string;
  type: string;
  text?: {
    body: string;
  };
}
