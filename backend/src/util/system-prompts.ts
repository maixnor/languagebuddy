import { Subscriber, Language } from "../features/subscriber/subscriber.types";
import { DateTime } from "luxon";
import { generateRegularSystemPrompt } from "../features/subscriber/subscriber.prompts";

interface SystemPromptContext {
  subscriber: Subscriber;
  conversationDurationMinutes: number | null;
  timeSinceLastMessageMinutes: number | null;
  currentLocalTime: DateTime;
  lastDigestTopic: string | null; // For future re-engagement
}

export function generateSystemPrompt({
  subscriber,
  conversationDurationMinutes,
  timeSinceLastMessageMinutes,
  currentLocalTime,
  lastDigestTopic
}: SystemPromptContext): string {
  // Determine target language (default to first learning language or a placeholder)
  // Ideally this should come from the current conversation context if multiple languages are being learned
  const targetLanguage: Language = subscriber.profile.learningLanguages?.[0] || {
    languageName: 'English',
    overallLevel: 'A1',
    skillAssessments: [],
    deficiencies: [],
    firstEncountered: new Date(),
    lastPracticed: new Date(),
    totalPracticeTime: 0,
    confidenceScore: 0
  };

  // Use the detailed "Maya" persona from subscriber features
  let prompt = generateRegularSystemPrompt(subscriber, targetLanguage);

  // Append dynamic time-aware context
  if (conversationDurationMinutes !== null) {
    prompt += `\n\nCONTEXT - CURRENT SESSION:\nConversation started ${conversationDurationMinutes.toFixed(0)} minutes ago.\n`;
  }

  if (timeSinceLastMessageMinutes !== null) {
    prompt += `Time since last message: ${timeSinceLastMessageMinutes.toFixed(0)} minutes.\n`;

    // Agent's behavior based on time gaps
    if (timeSinceLastMessageMinutes < 5) {
      prompt += `Continue the conversation as normal, it's a rapid exchange.\n`;
    } else if (timeSinceLastMessageMinutes >= 5 && timeSinceLastMessageMinutes < 60) {
      prompt += `Acknowledge the short break naturally, e.g., "Welcome back!" or "Back to our conversation!".\n`;
    } else if (timeSinceLastMessageMinutes >= 60 && timeSinceLastMessageMinutes < 6 * 60) { // 1 to 6 hours
      prompt += `Reference the time gap naturally, e.g., "Good to hear from you again after a while!".\n`;
    } else if (timeSinceLastMessageMinutes >= 6 * 60 && timeSinceLastMessageMinutes < 24 * 60) { // 6 to 24 hours
      prompt += `Treat this as a new conversation day. Offer a fresh start.\n`;
    } else if (timeSinceLastMessageMinutes >= 24 * 60) { // >24 hours
      prompt += `Offer a warm welcome back. If available, reference the previous topic.\n`;
      if (lastDigestTopic) {
        prompt += `Previous topic was: "${lastDigestTopic}". You can ask if they want to continue or start something new.\n`;
      }
    }
  }

  // Night-time awareness
  const hour = currentLocalTime.hour;
  if (hour >= 22 || hour < 6) { // 10 PM to 6 AM local time
    prompt += `It is currently late at night/early morning for the user (${currentLocalTime.toFormat('hh:mm a')}).
Suggest ending the conversation naturally soon, e.g., "It's getting late, perhaps we should continue tomorrow?" or "Good night!".\n`;
  }

  return prompt;
}
