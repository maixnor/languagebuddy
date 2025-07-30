//@ts-nocheck
import { DynamicStructuredTool } from "@langchain/core/tools";
import { Subscriber } from "../types";
import { SubscriberService } from "../services/subscriber-service";
import { logger } from "../config";
import { z } from "zod";
import { getContextVariable } from "@langchain/core/context";
import Redis from 'ioredis';
import { SubscriberUpdateContract, type SubscriberUpdateContract as SubscriberUpdateContractType } from './contracts';

let subscriberService: SubscriberService;

export function initializeSubscriberTools(redis: Redis) {
  subscriberService = SubscriberService.getInstance(redis);
}

export const updateSubscriberTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "update_subscriber_profile",
  description: "Update subscriber profile information, preferences, and notification settings when they share personal details",
  schema: SubscriberUpdateContract,
  func: async (input: SubscriberUpdateContractType) => {
    const updates = input;
    const phoneNumber = getContextVariable('phone') as string;
    if (!phoneNumber) {
      logger.error("Phone number not found in context");
      return "Phone number is required to update subscriber profile";
    }
    try {
      const existingSubscriber = await subscriberService.getSubscriber(phoneNumber);
      if (!existingSubscriber) {
        return "Subscriber not found";
      }

      // Map contract to domain object updates
      const domainUpdates: Partial<Subscriber> = {};
      
      if (updates.profile) {
        domainUpdates.profile = { ...existingSubscriber.profile };
        if (updates.profile.name) {
          domainUpdates.profile.name = updates.profile.name;
        }
        if (updates.profile.speakingLanguages) {
          // Map contract languages to domain languages
          domainUpdates.profile.speakingLanguages = updates.profile.speakingLanguages.map(lang => ({
            languageName: lang.languageName,
            level: lang.level,
            currentObjectives: lang.currentObjectives
          }));
        }
        if (updates.profile.learningLanguages) {
          // Map contract languages to domain languages  
          domainUpdates.profile.learningLanguages = updates.profile.learningLanguages.map(lang => ({
            languageName: lang.languageName,
            level: lang.level,
            currentObjectives: lang.currentObjectives
          }));
        }
        if (updates.profile.timezone) {
          domainUpdates.profile.timezone = updates.profile.timezone;
        }
      }
      
      if (updates.metadata) {
        domainUpdates.metadata = {
          ...existingSubscriber.metadata,
          ...updates.metadata
        };
      }

      // Merge updates into existing subscriber
      const updatedSubscriber = {
        ...existingSubscriber,
        ...domainUpdates
      };

      await subscriberService.updateSubscriber(phoneNumber, updatedSubscriber);
      return "Subscriber profile updated successfully!";
    } catch (error) {
      logger.error({ err: error, phone: phoneNumber, updates: updates }, "Error updating subscriber");
      return "Error updating subscriber profile";
    }
  }
});

export const subscriberTools = [
  updateSubscriberTool
];