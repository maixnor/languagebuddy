export interface Language {
  languageName: string;
  level?: string;
  currentObjectives?: string[];
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
    speakingLanguages?: Language[];
    learningLanguages?: Language[];
    timezone?: string;
    // favoriteColor?: string;
  }
  metadata: {
    digests: Digest[];
    personality: string;
    messagingPreferences?: {
      type: 'morning' | 'midday' | 'evening' | 'fixed';
      times?: string[]; // for fixed
    };
  }
  isPremium?: boolean;
  lastActiveAt?: Date;
  onboarding?: 'not_started' | 'in_progress' | 'completed';
  nextPushMessageAt?: string; // ISO string in UTC
}

export interface Digest {
  timestamp: string;
  vocabulary: string[];
  phrases: string[];
  grammar: string[];
  summary: string;
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
