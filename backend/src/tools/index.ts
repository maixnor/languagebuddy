import { DynamicStructuredTool } from "@langchain/core/tools";
import { feedbackTools } from "./feedback-tools";
import { subscriberTools } from "./subscriber-tools";
import { onboardingTools } from "./onboarding-tools";

export const tools: DynamicStructuredTool[] = [
    ...subscriberTools,
    ...feedbackTools,
    ...onboardingTools,
];