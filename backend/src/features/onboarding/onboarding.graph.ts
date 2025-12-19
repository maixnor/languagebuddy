import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { BaseMessage, HumanMessage, SystemMessage, AIMessage, RemoveMessage, ToolMessage } from "@langchain/core/messages";
import { StateGraph, END, START, addMessages } from "@langchain/langgraph";
import { AgentState } from "../../agents/agent.types";
import { SubscriberService } from "../subscriber/subscriber.service";
import { logger } from "../../core/observability/logging";
import { Subscriber } from "../subscriber/subscriber.types";

export const createOnboardingGraph = (llm: ChatOpenAI, subscriberService: SubscriberService) => {

    // Helper to get collected info from context
    const getContext = (state: AgentState) => state.subgraphState?.context || {};

    // Node: onboarding_agent
    const onboardingAgent = async (state: AgentState) => {
        const { subscriber, subgraphState, messages } = state;
        const subMessages = subgraphState?.messages || [];
        const context = getContext(state);
        
        // Accumulate new messages into subMessages
        const lastMainMsg = messages[messages.length - 1];
        let newSubMessages = [...subMessages];
        
        if (lastMainMsg instanceof HumanMessage) {
            const lastSubMsg = subMessages[subMessages.length - 1];
            if (!lastSubMsg || lastSubMsg.content !== lastMainMsg.content) {
                newSubMessages.push(lastMainMsg);
            }
        }

        // Determine what is missing
        const missingFields = [];
        if (!context.nativeLanguage) missingFields.push("Native Language");
        if (!context.targetLanguage) missingFields.push("Target Language");
        if (!context.name) missingFields.push("Name");
        if (!context.timezone) missingFields.push("Timezone/City");
        if (!context.referralSource) missingFields.push("Referral Source");
        if (!context.assessedLevel) missingFields.push("Assessed Language Level");

        const systemPrompt = `You are Maya, a friendly and supportive language learning buddy.
You are helping a new user (${context.name || "the user"}) get set up.
Your goal is to guide them through a short onboarding process.

CURRENT PROGRESS:
Collected: ${JSON.stringify(context)}
Missing: ${missingFields.join(", ")}

INSTRUCTIONS:
1. Speak naturally. Don't be a robot.
2. If the user greets you in a foreign language, try to infer their Native Language or Target Language.
3. Ask for ONE piece of missing information at a time.
   - Priority: Native Language -> Target Language -> Name -> Timezone -> Referral -> Level Assessment.
4. For "Assessed Language Level":
   - Once you have the languages, have a VERY BRIEF exchange (1-2 turns) in the Target Language to guess their level (A1-C2).
   - Do NOT ask "what is your level?". Assess it yourself based on their grammar/complexity.
5. When you have NEW information, CALL THE TOOL 'update_onboarding_context'.
6. When ALL fields are collected (including assessedLevel), CALL THE TOOL 'complete_onboarding'.

Valid Levels: A1, A2, B1, B2, C1, C2.
Valid Timezones: IANA format (e.g. America/New_York) or major city name.

Start by introducing yourself if you haven't yet.`;

        const toolBoundLlm = llm.bindTools([
            {
                name: "update_onboarding_context",
                description: "Save collected profile information.",
                schema: z.object({
                    nativeLanguage: z.string().optional(),
                    targetLanguage: z.string().optional(),
                    name: z.string().optional(),
                    timezone: z.string().optional(),
                    referralSource: z.string().optional(),
                    assessedLevel: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).optional()
                })
            },
            {
                name: "complete_onboarding",
                description: "Finalize the onboarding process when all fields are present.",
                schema: z.object({
                    summary: z.string().describe("A welcoming summary message to transition to the main experience.")
                })
            }
        ]);

        const response = await toolBoundLlm.invoke([new SystemMessage(systemPrompt), ...newSubMessages]);

        newSubMessages.push(response);

        return {
            subgraphState: {
                messages: newSubMessages,
                context: context
            },
            messages: [response]
        };
    };

    // Node: update_context
    const updateContext = async (state: AgentState) => {
        const { subgraphState } = state;
        const subMessages = subgraphState?.messages || [];
        const lastMessage = subMessages[subMessages.length - 1];
        
        const toolCall = lastMessage.tool_calls?.[0];
        if (!toolCall) return {};

        const updates = toolCall.args;
        const currentContext = subgraphState?.context || {};

        // Create tool response message to satisfy LLM history
        const toolMessage = new ToolMessage({
            tool_call_id: toolCall.id!,
            content: "Context updated successfully."
        });
        
        return {
            subgraphState: {
                messages: [...subMessages, toolMessage], // Append tool result
                context: { ...currentContext, ...updates }
            }
        };
    };

    // Node: finalize_onboarding
    const finalizeOnboarding = async (state: AgentState) => {
        const { subscriber, subgraphState } = state;
        const context = subgraphState?.context || {};
        const subMessages = subgraphState?.messages || [];
        
        // Call complete_onboarding tool was made.
        // We now update the real subscriber in DB.
        
        try {
            await subscriberService.updateSubscriber(subscriber.connections.phone, {
                status: 'active',
                profile: {
                    ...subscriber.profile, // Keep existing structure
                    name: context.name || subscriber.profile.name,
                    timezone: context.timezone || subscriber.profile.timezone,
                    speakingLanguages: [{
                        languageName: context.nativeLanguage || "English",
                        overallLevel: "C2",
                        confidenceScore: 100,
                        firstEncountered: new Date(),
                        lastPracticed: new Date(),
                        totalPracticeTime: 0,
                        skillAssessments: [],
                        deficiencies: []
                    }],
                    learningLanguages: [{
                        languageName: context.targetLanguage || "Spanish",
                        overallLevel: context.assessedLevel || "A1",
                        confidenceScore: 50,
                        firstEncountered: new Date(),
                        lastPracticed: new Date(),
                        totalPracticeTime: 0,
                        skillAssessments: [],
                        deficiencies: [],
                        currentLanguage: true
                    }],
                    referralSource: context.referralSource
                }
            });
            logger.info({ phone: subscriber.connections.phone }, "Onboarding completed via Subgraph");
        } catch (e) {
            logger.error(e, "Failed to finalize onboarding");
        }

        // Cleanup: Remove onboarding history to keep main chat clean
        // We only keep the summary message provided by the tool call, 
        // OR we generate a standard "Welcome aboard" message.
        // The last AI message had the tool call. It's not a text response.
        
        // We'll return the summary from the tool args if available, or a default one.
        // But the previous node (onboardingAgent) already pushed the AI response (tool call) to 'messages'.
        // We want to replace all that noise with just the summary.
        
        // Finding the tool call payload
        const toolCallMsg = subMessages[subMessages.length - 1];
        const summary = toolCallMsg.tool_calls?.[0]?.args?.summary || "You're all set! Let's start learning.";
        const summaryMsg = new AIMessage(summary);

        // Delete all previous messages generated in this subgraph from the main history
        // Similar to Feedback graph
        const deleteOperations = subMessages.map(m => {
            if (m.id) return new RemoveMessage({ id: m.id });
            return null;
        }).filter(Boolean) as BaseMessage[];

        return {
            messages: [...deleteOperations, summaryMsg],
            subgraphState: null, // Clear subgraph state
            activeMode: "conversation" as const,
            // Update local subscriber state to reflect changes immediately
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
    .addNode("update_context", updateContext)
    .addNode("finalize_onboarding", finalizeOnboarding)
    
    .addEdge(START, "onboarding_agent")
    
    .addConditionalEdges("onboarding_agent", (state) => {
        const subMessages = state.subgraphState?.messages || [];
        const lastMsg = subMessages[subMessages.length - 1];
        const toolCalls = lastMsg.tool_calls || [];
        
        if (toolCalls.some(tc => tc.name === "complete_onboarding")) {
            return "finalize_onboarding";
        }
        if (toolCalls.some(tc => tc.name === "update_onboarding_context")) {
            return "update_context";
        }
        return END; // Wait for user input
    }, {
        finalize_onboarding: "finalize_onboarding",
        update_context: "update_context",
        [END]: END
    })
    
    .addEdge("update_context", "onboarding_agent") // Loop back to ask next question
    .addEdge("finalize_onboarding", END);

    return graph.compile();
}
