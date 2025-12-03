import { Language, Subscriber } from "../features/subscriber/subscriber.types";
import { DateTime } from "luxon";

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
  let prompt = `You are LanguageBuddy, an AI language tutor. Your goal is to help the user practice and improve their target language.
  
User's target language: ${subscriber.profile.learningLanguages?.[0]?.languageName || 'English'}
User's native language: ${subscriber.profile.speakingLanguages?.[0]?.languageName || 'unknown'}
User's current fluency level: ${subscriber.profile.fluencyLevel || 'beginner'}
User's areas of struggle: ${subscriber.profile.areasOfStruggle.join(', ') || 'none'}
Mistake tolerance: ${subscriber.profile.mistakeTolerance || 'none'}

Current Date and Time (User's Local Time): ${currentLocalTime.toLocaleString(DateTime.DATETIME_FULL)}
`;

  if (conversationDurationMinutes !== null) {
    prompt += `Conversation started ${conversationDurationMinutes.toFixed(0)} minutes ago.
`;
  }

  if (timeSinceLastMessageMinutes !== null) {
    prompt += `Time since last message: ${timeSinceLastMessageMinutes.toFixed(0)} minutes.
`;

    // Agent's behavior based on time gaps
    if (timeSinceLastMessageMinutes < 5) {
      prompt += `Continue the conversation as normal, it's a rapid exchange.
`;
    } else if (timeSinceLastMessageMinutes >= 5 && timeSinceLastMessageMinutes < 60) {
      prompt += `Acknowledge the short break naturally, e.g., "Welcome back!" or "Back to our conversation!".
`;
    } else if (timeSinceLastMessageMinutes >= 60 && timeSinceLastMessageMinutes < 6 * 60) { // 1 to 6 hours
      prompt += `Reference the time gap naturally, e.g., "Good to hear from you again after a while!".
`;
    } else if (timeSinceLastMessageMinutes >= 6 * 60 && timeSinceLastMessageMinutes < 24 * 60) { // 6 to 24 hours
      prompt += `Treat this as a new conversation day. Offer a fresh start.
`;
    } else if (timeSinceLastMessageMinutes >= 24 * 60) { // >24 hours
      prompt += `Offer a warm welcome back. If available, reference the previous topic.
`;
      if (lastDigestTopic) {
        prompt += `Previous topic was: "${lastDigestTopic}". You can ask if they want to continue or start something new.
`;
      }
    }
  }

  // Night-time awareness
  const hour = currentLocalTime.hour;
  if (hour >= 22 || hour < 6) { // 10 PM to 6 AM local time
    prompt += `It is currently late at night/early morning for the user (${currentLocalTime.toFormat('hh:mm a')}).
Suggest ending the conversation naturally soon, e.g., "It's getting late, perhaps we should continue tomorrow?" or "Good night!".
`;
  }

  return prompt;
}