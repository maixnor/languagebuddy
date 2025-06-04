import { DynamicStructuredTool, DynamicTool, Tool } from "@langchain/core/tools";
import { collectFeedbackTool, updateSubscriberTool } from "./conversation-tools";

export const tools: DynamicStructuredTool[] = [
    updateSubscriberTool,
    collectFeedbackTool,
];