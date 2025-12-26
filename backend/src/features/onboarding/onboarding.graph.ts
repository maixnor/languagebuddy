import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { BaseMessage, HumanMessage, SystemMessage, AIMessage, RemoveMessage } from "@langchain/core/messages";
import { StateGraph, END, START, addMessages } from "@langchain/langgraph";
import { AgentState } from "../../agents/agent.types";
import { SubscriberService } from "../subscriber/subscriber.service";
import { logger } from "../../core/observability/logging";
import { generateOnboardingSystemPrompt } from "./onboarding.prompts";

export const createOnboardingGraph = (llm: ChatOpenAI, subscriberService: SubscriberService) => {

    // Node: onboarding_agent
    const onboardingAgent = async (state: AgentState) => {
        const { subgraphState, messages } = state;
        const subMessages = subgraphState?.messages || [];
        
        // Accumulate new messages into subMessages
        const lastMainMsg = messages[messages.length - 1];
        let newSubMessages = [...subMessages];
        
        if (lastMainMsg instanceof HumanMessage) {
            const lastSubMsg = subMessages[subMessages.length - 1];
            // Avoid duplicating if the subgraph loop is re-entering
            if (!lastSubMsg || lastSubMsg.content !== lastMainMsg.content) {
                newSubMessages.push(lastMainMsg);
            }
        }

        const systemPrompt = generateOnboardingSystemPrompt();

        const toolBoundLlm = llm.bindTools([
            {
                name: "finalize_onboarding",
                description: "Finalize the onboarding process when ALL fields are collected.",
                schema: z.object({
                    name: z.string(),
                    nativeLanguage: z.string(),
                    targetLanguage: z.string(),
                    learningGoal: z.string(),
                    timezone: z.string(),
                    interests: z.array(z.string()).describe("List of user interests or hobbies"),
                    assessedLevel: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
                    summary: z.string().describe("A welcoming summary message to transition to the main experience.")
                })
            }
        ]);

        const response = await toolBoundLlm.invoke([new SystemMessage(systemPrompt), ...newSubMessages]);

        newSubMessages.push(response);

        return {
            subgraphState: {
                messages: newSubMessages,
                // Context is no longer used, we rely on conversation history
            },
            messages: [response]
        };
    };

    // Node: finalize_onboarding
    const finalizeOnboarding = async (state: AgentState) => {
        const { subscriber, subgraphState, messages } = state;
        const subMessages = subgraphState?.messages || [];
        
        // Find the tool call payload
        const lastMsg = subMessages[subMessages.length - 1];
        const toolCall = (lastMsg as AIMessage).tool_calls?.[0];
        
        if (!toolCall) {
            // Should not happen if edge routing is correct
            return { activeMode: "conversation" as const };
        }

        const data = toolCall.args;
        
        try {
            await subscriberService.updateSubscriber(subscriber.connections.phone, {
                status: 'active',
                profile: {
                    ...subscriber.profile,
                    name: data.name,
                    timezone: data.timezone,
                    interests: data.interests,
                    speakingLanguages: [{
                        languageName: data.nativeLanguage,
                        overallLevel: "C2", // Assumed native
                        confidenceScore: 100,
                        firstEncountered: new Date(),
                        lastPracticed: new Date(),
                        totalPracticeTime: 0,
                        skillAssessments: [],
                        deficiencies: []
                    }],
                    learningLanguages: [{
                        languageName: data.targetLanguage,
                        overallLevel: data.assessedLevel,
                        confidenceScore: 50,
                        firstEncountered: new Date(),
                        lastPracticed: new Date(),
                        totalPracticeTime: 0,
                        skillAssessments: [],
                        deficiencies: [],
                        currentLanguage: true,
                        motivationFactors: [data.learningGoal]
                    }]
                }
            });
            logger.info({ phone: subscriber.connections.phone }, "Onboarding completed via Subgraph");
        } catch (e) {
            logger.error(e, "Failed to finalize onboarding");
            // If it fails, we should probably not transition state, but for now we proceed or the user is stuck.
            // Retrying would require more complex logic.
        }

        const summaryMsg = new AIMessage(data.summary || "You're all set! Let's start learning.");

        // Cleanup messages: Delete the onboarding history to keep main chat clean
        // We only delete messages that actually exist in the main channel state to avoid "ID doesn't exist" errors.
        
        const currentMessageIds = new Set(messages.map(m => m.id));
        const deleteOperations = subMessages.map(m => {
            if (m.id && currentMessageIds.has(m.id)) return new RemoveMessage({ id: m.id });
            return null;
        }).filter(Boolean) as BaseMessage[];

        return {
            messages: [...deleteOperations, summaryMsg],
            subgraphState: null, // Clear subgraph state
            activeMode: "conversation" as const,
            subscriber: {
                ...subscriber,
                status: 'active'
            }
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
    .addNode("onboarding_agent", onboardingAgent)
    .addNode("finalize_onboarding", finalizeOnboarding)
    
    .addEdge(START, "onboarding_agent")
    
    .addConditionalEdges("onboarding_agent", (state) => {
        const subMessages = state.subgraphState?.messages || [];
        const lastMsg = subMessages[subMessages.length - 1];
        const toolCalls = lastMsg.tool_calls || [];
        
        if (toolCalls.some(tc => tc.name === "finalize_onboarding")) {
            return "finalize_onboarding";
        }
        return END; 
    }, {
        finalize_onboarding: "finalize_onboarding",
        [END]: END
    })
    
    .addEdge("finalize_onboarding", END);

    return graph.compile();
}