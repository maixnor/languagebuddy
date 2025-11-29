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

  userMemos?: string[]; // Personal memos about the user for better context in future conversations
}
