//@ts-nocheck
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getContextVariable } from "@langchain/core/context";
import { logger } from "../config";
import { OnboardingService } from "../services/onboarding-service";
import { SubscriberService } from "../services/subscriber-service";
import { Language } from "../types";
import Redis from 'ioredis';

let onboardingService: OnboardingService;
let subscriberService: SubscriberService;

export function initializeOnboardingTools(redis: Redis) {
  onboardingService = OnboardingService.getInstance(redis);
  subscriberService = SubscriberService.getInstance(redis);
}

export const recordGdprConsent = new DynamicStructuredTool({
  name: "record_gdpr_consent",
  description: "Record that the user has given GDPR consent during onboarding",
  schema: z.object({
    consented: z.boolean().describe("Whether the user has given GDPR consent")
  }),
  func: async ({ consented }) => {
    const phone = getContextVariable("phone") as string;
    
    if (!phone) {
      throw new Error("No phone number found in context");
    }

    await onboardingService.updateOnboardingState(phone, {
      gdprConsented: consented,
      currentStep: consented ? 'profile_gathering' : 'gdpr_consent'
    });

    logger.info({ phone, consented }, "Recorded GDPR consent");
    return `GDPR consent recorded as ${consented}. ${consented ? 'Proceeding to profile gathering.' : 'Cannot proceed without consent.'}`;
  }
});

export const updateOnboardingProfile = new DynamicStructuredTool({
  name: "update_onboarding_profile",
  description: "Update the user's profile information during onboarding (name, native languages, timezone)",
  schema: z.object({
    name: z.string().optional().describe("User's name"),
    nativeLanguages: z.array(z.string()).optional().describe("Languages the user speaks natively"),
    timezone: z.string().optional().describe("User's timezone (e.g., 'Europe/Vienna', 'America/New_York')")
  }),
  func: async ({ name, nativeLanguages, timezone }) => {
    const phone = getContextVariable("phone") as string;
    
    if (!phone) {
      throw new Error("No phone number found in context");
    }

    const currentState = await onboardingService.getOnboardingState(phone);
    if (!currentState) {
      throw new Error("No onboarding state found");
    }

    const tempData = currentState.tempData || {};
    if (name) tempData.name = name;
    if (nativeLanguages) tempData.nativeLanguages = nativeLanguages;
    if (timezone) tempData.timezone = timezone;

    await onboardingService.updateOnboardingState(phone, {
      tempData,
      currentStep: 'target_language'
    });

    logger.info({ phone, name, nativeLanguages, timezone }, "Updated onboarding profile");
    return `Profile updated. Name: ${name || 'not set'}, Native languages: ${nativeLanguages?.join(', ') || 'not set'}, Timezone: ${timezone || 'not set'}`;
  }
});

export const setTargetLanguage = new DynamicStructuredTool({
  name: "set_target_language",
  description: "Set the language the user wants to learn",
  schema: z.object({
    targetLanguage: z.string().describe("The language the user wants to learn")
  }),
  func: async ({ targetLanguage }) => {
    const phone = getContextVariable("phone") as string;
    
    if (!phone) {
      throw new Error("No phone number found in context");
    }

    const currentState = await onboardingService.getOnboardingState(phone);
    if (!currentState) {
      throw new Error("No onboarding state found");
    }

    const tempData = currentState.tempData || {};
    tempData.targetLanguage = targetLanguage;

    await onboardingService.updateOnboardingState(phone, {
      tempData,
      currentStep: 'explaining_features'
    });

    logger.info({ phone, targetLanguage }, "Set target language");
    return `Target language set to ${targetLanguage}. Ready to explain features.`;
  }
});

export const startAssessmentConversation = new DynamicStructuredTool({
  name: "start_assessment_conversation",
  description: "Mark the beginning of the language assessment conversation",
  schema: z.object({}),
  func: async () => {
    const phone = getContextVariable("phone") as string;
    
    if (!phone) {
      throw new Error("No phone number found in context");
    }

    const currentState = await onboardingService.getOnboardingState(phone);
    if (!currentState) {
      throw new Error("No onboarding state found");
    }

    const tempData = currentState.tempData || {};
    tempData.assessmentStarted = true;
    tempData.messagesInAssessment = 0;

    await onboardingService.updateOnboardingState(phone, {
      tempData,
      currentStep: 'assessment_conversation'
    });

    logger.info({ phone }, "Started assessment conversation");
    return "Assessment conversation started. Begin natural conversation to assess language level.";
  }
});

export const completeOnboardingAndCreateSubscriber = new DynamicStructuredTool({
  name: "complete_onboarding_and_create_subscriber",
  description: "Complete the onboarding process and create the full subscriber profile",
  schema: z.object({
    detectedSkillLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).describe("Detected CEFR skill level"),
    languageDeficiencies: z.array(z.object({
      category: z.enum(['grammar', 'vocabulary', 'comprehension', 'cultural-context', 'spelling', 'syntax']),
      specificArea: z.string().describe("Specific area like 'past tense', 'business vocabulary'"),
      severity: z.enum(['minor', 'moderate', 'major']),
      examples: z.array(z.string()).describe("Examples from the conversation"),
      improvementSuggestions: z.array(z.string())
    })).describe("Identified language deficiencies from the assessment")
  }),
  func: async ({ detectedSkillLevel, languageDeficiencies }) => {
    const phone = getContextVariable("phone") as string;
    
    if (!phone) {
      throw new Error("No phone number found in context");
    }

    const onboardingState = await onboardingService.getOnboardingState(phone);
    if (!onboardingState || !onboardingState.tempData) {
      throw new Error("No complete onboarding state found");
    }

    const { tempData } = onboardingState;
    
    // Create native languages
    const speakingLanguages: Language[] = (tempData.nativeLanguages || []).map(langName => ({
      languageName: langName,
      overallLevel: 'C2' as const, // Native level
      skillAssessments: [],
      deficiencies: [],
      firstEncountered: new Date(),
      lastPracticed: new Date(),
      totalPracticeTime: 0,
      confidenceScore: 100
    }));

    // Create target language with assessment data
    const learningLanguages: Language[] = tempData.targetLanguage ? [{
      languageName: tempData.targetLanguage,
      overallLevel: detectedSkillLevel,
      skillAssessments: [],
      deficiencies: languageDeficiencies.map(def => ({
        ...def,
        frequency: 50, // Default frequency
        firstDetected: new Date(),
        lastOccurrence: new Date()
      })),
      firstEncountered: new Date(),
      lastPracticed: new Date(),
      totalPracticeTime: 0,
      confidenceScore: 50 // Default confidence for learning language
    }] : [];

    // Create the subscriber
    await subscriberService.createSubscriber(phone, {
      profile: {
        name: tempData.name || "New User",
        speakingLanguages,
        learningLanguages,
        timezone: tempData.timezone
      }
    });

    // Complete onboarding
    await onboardingService.completeOnboarding(phone);

    logger.info({ phone, detectedSkillLevel, deficienciesCount: languageDeficiencies.length }, "Completed onboarding and created subscriber");
    return `Onboarding completed! Created subscriber profile with ${speakingLanguages.length} native language(s), target language ${tempData.targetLanguage} at ${detectedSkillLevel} level, and ${languageDeficiencies.length} identified areas for improvement.`;
  }
});

export const onboardingTools = [
  recordGdprConsent,
  updateOnboardingProfile,
  setTargetLanguage,
  startAssessmentConversation,
  completeOnboardingAndCreateSubscriber
];
