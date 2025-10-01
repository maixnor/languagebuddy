import { DynamicStructuredTool } from "@langchain/core/tools";
import { subscriberTools } from "./subscriber-tools";
import { feedbackTools } from "./feedback-tools";

export const tools: DynamicStructuredTool[] = [
    ...subscriberTools,
    ...feedbackTools,
];