
export interface FeedbackEntry {
  timestamp: string;
  originalMessage: string;
  userFeedback: string;
  userPhone: string;
  sentiment: "positive" | "negative" | "neutral";
  actionItems: string[];
  category: "content" | "technical" | "suggestion" | "other";
}


