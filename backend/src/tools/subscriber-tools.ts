import { tool } from "@langchain/core/tools";
import { Subscriber } from "../types";
import { SubscriberService } from "../services/subscriber-service";
import { logger } from "../config";
import z from "zod";

export const updateSubscriberTool = tool(
  async ({ phoneNumber, updates }: { 
    phoneNumber: string,
    updates: Partial<Subscriber>
  }) => {
    try {
      const subscriberService = SubscriberService.getInstance();
      await subscriberService.updateSubscriber(phoneNumber, updates);
      return "Profile updated successfully!";
    } catch (error) {
      logger.error({ err: error, phoneNumber, updates }, "Error updating subscriber");
      return "I had trouble saving that information. Could you try again?";
    }
  },
  {
    name: "update_subscriber",
    description: "Update subscriber profile information when they share personal details",
    schema: z.object({
      phoneNumber: z.string(),
      updates: z.object({
        name: z.string().optional(),
        speakingLanguages: z.array(z.object({
          languageName: z.string(),
          level: z.string().optional(),
          currentObjectives: z.array(z.string()).optional()
        })).optional(),
        learningLanguages: z.array(z.object({
          languageName: z.string(),
          level: z.string().optional(),
          currentObjectives: z.array(z.string()).optional()
        })).optional(),
        timezone: z.string().optional(),
      })
    }),
  }
);