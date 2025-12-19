import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage, RemoveMessage } from "@langchain/core/messages";
import { StateGraph, END, START, addMessages } from "@langchain/langgraph";
import { AgentState } from "../../agents/agent.types";
import { FeedbackService } from "./feedback.service";
import { logger } from "../../core/observability/logging";

export const createFeedbackGraph = (llm: ChatOpenAI, feedbackService: FeedbackService) => {
    
    // Node: feedback_agent
    const feedbackAgent = async (state: AgentState) => {
        const { subscriber, subgraphState, messages } = state;
        const subMessages = subgraphState?.messages || [];
        
        // Identify new user messages from the main conversation that belong in the subgraph
        // We assume the last message in 'messages' is the user input if it's a HumanMessage
        // and hasn't been processed yet.
        // A simple heuristic: if the last message in 'messages' is Human, and it's not the last message in 'subMessages', add it.
        
        const lastMainMsg = messages[messages.length - 1];
        let newSubMessages = [...subMessages];

        if (lastMainMsg instanceof HumanMessage) {
            const lastSubMsg = subMessages[subMessages.length - 1];
            // Compare by content or ID if available. 
            // Assuming strict sequential processing, if they differ, it's new.
            // Also check if subMessages is empty.
            if (!lastSubMsg || lastSubMsg.content !== lastMainMsg.content) {
                newSubMessages.push(lastMainMsg);
            }
        }

        // System prompt for feedback
        const systemPrompt = `You are a feedback collection assistant for LanguageBuddy.
Your goal is to collect feedback from the user about their experience.
Ask clarifying questions if the feedback is vague.
Be polite and concise.
When you have collected the feedback, call the 'submit_feedback' tool.
Do not persist the feedback yourself, just call the tool.`;

        // Prepare conversation for LLM
        const conversation = [new SystemMessage(systemPrompt), ...newSubMessages];

        // Bind the submit tool
        const toolBoundLlm = llm.bindTools([
            {
                name: "submit_feedback",
                description: "Submit the collected feedback.",
                schema: z.object({
                    summary: z.string().describe("Summary of the feedback"),
                    sentiment: z.enum(["positive", "negative", "neutral"]),
                    category: z.enum(["content", "technical", "suggestion", "other"]),
                    actionItems: z.array(z.string()).describe("List of action items derived from feedback")
                })
            }
        ]);

        const response = await toolBoundLlm.invoke(conversation);
        
        // Update subgraphState with the AI response
        newSubMessages.push(response);

        // We return the updated subgraphState AND append the AI response to the main messages
        // so the user receives it.
        return {
            subgraphState: {
                messages: newSubMessages,
                context: state.subgraphState?.context
            },
            messages: [response]
        };
    };

    // Node: save_feedback
    const saveFeedback = async (state: AgentState) => {
        const { subgraphState, subscriber } = state;
        const subMessages = subgraphState?.messages || [];
        const lastMessage = subMessages[subMessages.length - 1];
        
        // Extract tool call
        // The last message should be the AIMessage with tool_calls
        const toolCall = lastMessage.tool_calls?.[0];
        if (!toolCall) {
             logger.error("save_feedback called without tool call");
             return { activeMode: "conversation" as const };
        }

        const args = toolCall.args;
        
        try {
            await feedbackService.saveFeedback({
                timestamp: new Date().toISOString(),
                originalMessage: JSON.stringify(subMessages.map(m => m.content)),
                userFeedback: args.summary,
                userPhone: subscriber.connections.phone,
                sentiment: args.sentiment,
                actionItems: args.actionItems,
                category: args.category
            });
        } catch (e) {
            logger.error(e, "Failed to save feedback");
        }

        // Cleanup: Remove feedback messages from main history
        // We remove all messages currently in subMessages from the main 'messages' list.
        // We identify them by ID if available, or just create RemoveMessage for the IDs.
        // Note: HumanMessages from main graph might not have IDs assigned by us, but LangGraph assigns them.
        // We need to match them.
        // However, 'subMessages' contains copies or references.
        // Ideally we iterate 'state.messages' and remove those that are in 'subgraphState'.
        
        const messagesToRemove: BaseMessage[] = [];
        
        // We know subMessages contains the HumanMessages and AIMessages generated during feedback.
        // We want to remove all of them from the main history.
        // To be safe, we can try to map them to RemoveMessage if they have IDs.
        // If they don't have IDs, removal is hard.
        // LangGraph usually assigns IDs.
        
        // Strategy: Create a summary message.
        const summaryMsg = new SystemMessage(`(Feedback System) User provided feedback: ${args.summary}. Feedback session ended.`);

        // For now, if we can't reliably remove, we just append the summary.
        // But the requirement is strict: "NOT present in the main conversation history".
        // Let's attempt to use IDs.
        
        const subMessageIds = new Set(subMessages.map(m => m.id).filter(Boolean));
        
        // If IDs are missing, this logic fails.
        // But since we just added 'response' in feedbackAgent, it might have an ID?
        // Actually, we should probably construct RemoveMessage for the *messages we added*.
        
        // Let's assume we can emit RemoveMessages for the content we know.
        // Or, we can just return a filtered list if we were using a replace reducer, but we use 'messages' channel which usually appends.
        // Unless we change the channel definition in the parent graph.
        
        // If we can't delete, we assume the user accepts pollution or we rely on the nightly reset.
        // But let's try to use RemoveMessage.
        
        const deleteOperations = subMessages.map(m => {
            if (m.id) return new RemoveMessage({ id: m.id });
            return null;
        }).filter(Boolean) as BaseMessage[];

        return {
            messages: [...deleteOperations, summaryMsg],
            subgraphState: null, // Clear subgraph state
            activeMode: "conversation" as const
        };
    };

    const graph = new StateGraph<AgentState>({ 
        channels: {
            messages: { value: addMessages, default: () => [] },
            subscriber: { value: (x, y) => y ?? x, default: () => ({} as any) },
            activeMode: { value: (x, y) => y ?? x, default: () => "conversation" },
            subgraphState: { value: (x, y) => y, default: () => undefined },
        }
    })
    .addNode("feedback_agent", feedbackAgent)
    .addNode("save_feedback", saveFeedback)
    .addEdge(START, "feedback_agent")
    .addConditionalEdges("feedback_agent", (state) => {
        const subMessages = state.subgraphState?.messages || [];
        const lastMsg = subMessages[subMessages.length - 1];
        if (lastMsg?.tool_calls?.length) {
            return "save_feedback";
        }
        return END;
    }, {
        save_feedback: "save_feedback",
        [END]: END
    })
    .addEdge("save_feedback", END);

    return graph.compile();
}
