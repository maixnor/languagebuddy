import pino from "pino";

export interface Language {
  languageName: string;
  level: string;
  currentObjectives: string[];
}

export interface Subscriber {
  phone: string;
  name: string;
  speakingLanguages: Language[];
  learningLanguages: Language[];
  messageHistory: any[];
  isPremium?: boolean;
  timezone?: string;
  lastActiveAt?: Date;
  conversationDigests?: ConversationDigest[];
}

export interface SystemPromptEntry {
  slug: string;
  prompt: string;
  firstUserMessage: string;
}

export interface ConversationDigest {
  date: string;
  vocabulary: VocabularyItem[];
  learningProgress: string;
  suggestedReview: string[];
  conversationSummary: string;
}

export interface VocabularyItem {
  word: string;
  definition: string;
  example: string;
  language: string;
  difficulty: number;
  timesEncountered: number;
  lastEncountered: Date;
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

// LangGraph State Interface
export interface ConversationState {
  messages: any[];
  subscriber: Subscriber;
  shouldEnd: boolean;
  feedbackRequested: boolean;
  feedbackReceived: boolean;
  originalMessage?: string;
  conversationMode: 'chatting' | 'tutoring' | 'feedback';
  isPremium: boolean;
  sessionStartTime: Date;
  lastMessageTime?: Date;
}

export interface DailyMessageConfig {
  enabled: boolean;
  timeToSend: string; // "09:00"
  timezone: string;
}

export interface PersistenceConfig {
  retainForFreeUsers: boolean;
  maxHistoryLength: number;
  digestCreationTime: string; // "03:00"
}
