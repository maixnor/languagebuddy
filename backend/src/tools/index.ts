import { DynamicStructuredTool, DynamicTool, Tool } from "@langchain/core/tools";
import { collectFeedbackTool } from "./feedback-tools";
import { updateSubscriberTool } from "./subscriber-tools";

export const tools: DynamicStructuredTool[] = [
    updateSubscriberTool,
    collectFeedbackTool,
];