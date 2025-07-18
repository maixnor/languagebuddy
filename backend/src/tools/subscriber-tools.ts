import { tool } from "@langchain/core/tools";
import { Subscriber } from "../types";
import { SubscriberService } from "../services/subscriber-service";
import { logger } from "../config";
import z from "zod";
import {getContextVariable} from "@langchain/core/context";

export const updateSubscriberTool = tool(
  async ({ updates }: {
    updates: Partial<Subscriber>
  }) => {
    const phoneNumber = getContextVariable('phone');
    if (!phoneNumber) {
      logger.error("Phone number not found in context");
      return "Phone number is required to update subscriber profile";
    }
    try {
      const subscriberService = SubscriberService.getInstance();
      const existingSubscriber = await subscriberService.getSubscriber(phoneNumber);
      // Merge profile and metadata updates
      if (updates.profile) {
        Object.assign(existingSubscriber!.profile, updates.profile);
      }
      if (updates.metadata) {
        existingSubscriber!.metadata = {
          ...existingSubscriber!.metadata,
          ...updates.metadata,
        };
      }
      await subscriberService.updateSubscriber(phoneNumber, existingSubscriber!);
      return "Subscriber profile updated successfully!";
    } catch (error) {
      logger.error({ err: error, phone: phoneNumber, updates: updates }, "Error updating subscriber");
      return "Error updating subscriber profile";
    }
  },
  {
    name: "update_subscriber_profile",
    description: "Update subscriber profile information, preferences, and notification settings when they share personal details",
    schema: z.object({
      updates: z.object({
        profile: z.object({
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
        }).partial().optional(),
        metadata: z.object({
          messagingPreferences: z.object({
            type: z.enum(['morning', 'midday', 'evening', 'fixed']).optional(),
            times: z.array(z.string()).optional(),
          }).partial().optional(),
        }).partial().optional(),
      }).partial(),
    }),
  }
);