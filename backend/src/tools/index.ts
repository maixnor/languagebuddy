import { DynamicStructuredTool } from "@langchain/core/tools";
import { feedbackTools } from "./feedback-tools";

export const tools: DynamicStructuredTool[] = [
    ...feedbackTools,
];