import { z } from "zod";

export const LanguageContract = z.object({
  languageName: z.string(),
  level: z.string().optional().nullable(),
  currentObjectives: z.array(z.string()).optional().nullable()
});

export const ProfileUpdateContract = z.object({
  name: z.string().optional().nullable(),
  speakingLanguages: z.array(LanguageContract).optional().nullable(),
  learningLanguages: z.array(LanguageContract).optional().nullable(),
  timezone: z.string().optional().nullable(),
  interests: z.array(z.string()).optional().nullable(),
  referralSource: z.string().optional().nullable(),
});

export const MessagingPreferencesContract = z.object({
  type: z.enum(['morning', 'midday', 'evening', 'fixed']).optional().nullable(),
  times: z.array(z.string()).optional().nullable(),
});

export const MetadataUpdateContract = z.object({
  messagingPreferences: MessagingPreferencesContract.optional().nullable(),
});

export const SubscriberUpdateContract = z.object({
  profile: ProfileUpdateContract.optional().nullable(),
  metadata: MetadataUpdateContract.optional().nullable(),
});

export const SetLanguageContract = z.object({
  languageCode: z.string().describe("The ISO 639-1 code of the language to set as the current learning language (e.g., 'es' for Spanish, 'en' for English)."),
});

export type SubscriberUpdateContract = z.infer<typeof SubscriberUpdateContract>;

export const SubscriberProfileSchema = z.object({
  name: z.string(),
  speakingLanguages: z.array(LanguageContract),
  learningLanguages: z.array(LanguageContract),
  timezone: z.string(),
  interests: z.array(z.string()).optional(),
  messagingPreferences: MessagingPreferencesContract.optional().nullable(),
  referralSource: z.string().optional(),
});

export type SubscriberProfile = z.infer<typeof SubscriberProfileSchema>;

