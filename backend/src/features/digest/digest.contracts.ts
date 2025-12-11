import { z } from 'zod';

export const DigestAnalysisSchema = z.object({
  topic: z.string().describe("Main topic/theme of the conversation in one sentence"),
  summary: z.string().describe("Comprehensive summary of what was discussed"),
  keyBreakthroughs: z.array(z.string()).default([]).describe("List of learning breakthroughs or achievements"),
  areasOfStruggle: z.array(z.string()).default([]).describe("Areas where the user struggled or made mistakes"),
  vocabulary: z.object({
    newWords: z.array(z.string()).default([]).describe("New words the user learned, highlight only words the user asked about or interacted with specifically"),
    reviewedWords: z.array(z.string()).default([]).describe("Words that were practiced or repeated"),
    struggledWith: z.array(z.string()).default([]).describe("Words the user had difficulty with"),
    mastered: z.array(z.string()).default([]).describe("Words the user used that demonstrate mastery of a subject")
  }),
  phrases: z.object({
    newPhrases: z.array(z.string()).default([]).describe("New phrases or expressions learned (only ones specifically interacted by the user)"),
    idioms: z.array(z.string()).default([]).describe("Idioms discussed or taught"),
    colloquialisms: z.array(z.string()).default([]).describe("Informal expressions used"),
    formalExpressions: z.array(z.string()).default([]).describe("Formal language patterns practiced")
  }),
  grammar: z.object({
    conceptsCovered: z.array(z.string()).default([]).describe("Grammar concepts that were discussed"),
    mistakesMade: z.array(z.string()).default([]).describe("Specific grammar mistakes the user made"),
    patternsPracticed: z.array(z.string()).default([]).describe("Grammar patterns the user practiced")
  }),
  assistantMistakes: z.array(z.object({
    originalText: z.string().describe("The incorrect text segment from the assistant"),
    correction: z.string().describe("The corrected version"),
    reason: z.string().describe("Why it was incorrect (e.g., 'Hallucination', 'Grammar', 'Factually incorrect')")
  })).default([]).describe("Mistakes made by the AI assistant during the conversation that need to be corrected for the user"),
  userMemos: z.array(z.string()).default([]).describe("Personal information about the user that should be remembered for future conversations (interests, background, preferences, etc.)")
});

export type DigestAnalysis = z.infer<typeof DigestAnalysisSchema>;
