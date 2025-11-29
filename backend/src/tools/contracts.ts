import { z } from "zod";

// Feedback tool contracts
export const FeedbackContract = z.object({
  originalMessage: z.string(),
  userFeedback: z.string(),
});

export type FeedbackContract = z.infer<typeof FeedbackContract>;
