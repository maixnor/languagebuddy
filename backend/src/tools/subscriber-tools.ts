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

export const createSubscriberTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "create_subscriber",
  description: "Create a new subscriber after completing the onboarding process with all collected information",
  schema: z.object({
    name: z.string().describe("The user's name"),
    nativeLanguages: z.array(z.string()).describe("Languages the user speaks natively"),
    targetLanguage: z.string().describe("The language the user wants to learn"),
    timezone: z.string().describe("The user's timezone"),
    assessedLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).describe("The assessed language level from the conversation"),
    skillAssessments: z.array(z.object({
      skill: z.enum(['grammar', 'vocabulary', 'comprehension', 'spelling', 'punctuation', 'text-coherence']),
      level: z.enum(['beginner', 'elementary', 'intermediate', 'upper-intermediate', 'advanced', 'proficient']),
      confidence: z.number().min(0).max(100),
      evidence: z.array(z.string())
    })).optional().describe("Detailed skill assessments from the conversation"),
    deficiencies: z.array(z.object({
      category: z.enum(['grammar', 'vocabulary', 'comprehension', 'cultural-context', 'spelling', 'syntax']),
      specificArea: z.string(),
      severity: z.enum(['minor', 'moderate', 'major']),
      examples: z.array(z.string())
    })).optional().describe("Identified areas needing improvement")
  }),
  func: async (input) => {
    const phoneNumber = getContextVariable('phone') as string;
    if (!phoneNumber) {
      logger.error("Phone number not found in context");
      return "Phone number is required to create subscriber";
    }

    try {
      // Check if subscriber already exists
      const existingSubscriber = await subscriberService.getSubscriber(phoneNumber);
      if (existingSubscriber) {
        return "Subscriber already exists";
      }

      // Prepare the subscriber data
      const subscriberData: Partial<Subscriber> = {
        profile: {
          name: input.name,
          speakingLanguages: input.nativeLanguages.map(lang => ({
            languageName: lang,
            overallLevel: 'C2' as const, // Native level
            skillAssessments: [],
            deficiencies: [],
            firstEncountered: new Date()
          })),
          learningLanguages: [{
            languageName: input.targetLanguage,
            overallLevel: input.assessedLevel,
            skillAssessments: input.skillAssessments?.map(assessment => ({
              ...assessment,
              lastAssessed: new Date(),
              evidence: assessment.evidence
            })) || [],
            deficiencies: input.deficiencies?.map(deficiency => ({
              ...deficiency,
              frequency: 50, // Default frequency
              improvementSuggestions: [],
              firstDetected: new Date(),
              lastOccurrence: new Date()
            })) || [],
            firstEncountered: new Date()
          }],
          timezone: input.timezone
        }
      };

      const newSubscriber = await subscriberService.createSubscriber(phoneNumber, subscriberData);

      if (onboardingService.isInOnboarding(phoneNumber)) {
        await onboardingService.completeOnboarding(phoneNumber);
      }

      logger.info({ phoneNumber, name: input.name, targetLanguage: input.targetLanguage }, "New subscriber created from onboarding");
      
      return `Successfully created subscriber profile for ${input.name}! They're ready to start learning ${input.targetLanguage} at ${input.assessedLevel} level.`;
    } catch (error) {
      logger.error({ err: error, phoneNumber, input }, "Error creating subscriber");
      return "Error creating subscriber profile";
    }
  }
});

export const subscriberTools = [
  updateSubscriberTool,
  createSubscriberTool
];