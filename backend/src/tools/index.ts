import { DynamicStructuredTool } from "@langchain/core/tools";
import { feedbackTools } from "./feedback-tools";
import { subscriberTools, initializeSubscriberTools } from "./subscriber-tools";
import { onboardingTools, initializeOnboardingTools } from "./onboarding-tools";
import { feedbackTools, initializeFeedbackTools } from "./feedback-tools";
import Redis from 'ioredis';

export function initializeTools(redis: Redis) {
    initializeSubscriberTools(redis);
    initializeOnboardingTools(redis);
    initializeFeedbackTools(redis);
}

export const tools: DynamicStructuredTool[] = [
    ...subscriberTools,
    ...feedbackTools,
    ...onboardingTools,
];