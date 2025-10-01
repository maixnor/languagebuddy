import { DynamicStructuredTool } from "@langchain/core/tools";
import { subscriberTools, initializeSubscriberTools } from "./subscriber-tools";
import { feedbackTools, initializeFeedbackTools } from "./feedback-tools";
import { digestTools } from "./digest-tools";
import Redis from 'ioredis';

export function initializeTools(redis: Redis) {
    initializeSubscriberTools(redis);
    initializeFeedbackTools(redis);
}

export const tools: DynamicStructuredTool[] = [
    ...subscriberTools,
    ...feedbackTools,
    ...digestTools,
];