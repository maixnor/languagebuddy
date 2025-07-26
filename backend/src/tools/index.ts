import { DynamicStructuredTool } from "@langchain/core/tools";
import { collectFeedbackTool } from "./feedback-tools";
import { updateSubscriberTool } from "./subscriber-tools";
import { onboardingTools } from "./onboarding-tools";

export const tools: DynamicStructuredTool[] = [
    updateSubscriberTool,
    collectFeedbackTool,
    ...onboardingTools,
];