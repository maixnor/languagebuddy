import { z } from "zod";

// Feedback tool contracts
export const FeedbackContract = z.object({
  originalMessage: z.string(),
  userFeedback: z.string(),
});

export type FeedbackContract = z.infer<typeof FeedbackContract>;

// Subscriber tool contracts
export const LanguageContract = z.object({
  languageName: z.string(),
  level: z.string().optional(),
  currentObjectives: z.array(z.string()).optional()
});

export const ProfileUpdateContract = z.object({
  name: z.string().optional(),
  speakingLanguages: z.array(LanguageContract).optional(),
  learningLanguages: z.array(LanguageContract).optional(),
  timezone: z.string().optional(),
});

export const MessagingPreferencesContract = z.object({
  type: z.enum(['morning', 'midday', 'evening', 'fixed']).optional(),
  times: z.array(z.string()).optional(),
});

export const MetadataUpdateContract = z.object({
  messagingPreferences: MessagingPreferencesContract.optional(),
});

export const SubscriberUpdateContract = z.object({
  profile: ProfileUpdateContract.optional(),
  metadata: MetadataUpdateContract.optional(),
});

export type SubscriberUpdateContract = z.infer<typeof SubscriberUpdateContract>;
