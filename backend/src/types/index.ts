import pino from "pino";

export interface Language {
  languageName: string;
  level?: string;
  currentObjectives?: string[];
}

export interface Subscriber {
  phone: string;
  name: string;
  speakingLanguages?: Language[];
  learningLanguages?: Language[];
  isPremium?: boolean;
  timezone?: string;
  lastActiveAt?: Date;
}

export interface SystemPromptEntry {
  slug: string;
  prompt: string;
  firstUserMessage: string;
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

// Simplified LangGraph State Interface
export interface ConversationState {
  messages: any[];
  subscriber: Subscriber;
  shouldEnd: boolean;
  conversationMode: 'chatting' | 'tutoring';
  isPremium: boolean;
  sessionStartTime: Date;
  lastMessageTime?: Date;
}
