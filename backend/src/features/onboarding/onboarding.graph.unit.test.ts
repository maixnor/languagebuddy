import { createOnboardingGraph } from "./onboarding.graph";
import { ChatOpenAI } from "@langchain/openai";
import { SubscriberService } from "../subscriber/subscriber.service";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { AgentState } from "../../agents/agent.types";

jest.mock("@langchain/openai");
jest.mock("../subscriber/subscriber.service");

describe("Onboarding Subgraph", () => {
    let mockLlm: jest.Mocked<ChatOpenAI>;
    let mockSubscriberService: jest.Mocked<SubscriberService>;
    let graph: any;

    beforeEach(() => {
        mockLlm = {
            bindTools: jest.fn().mockReturnThis(),
            invoke: jest.fn()
        } as unknown as jest.Mocked<ChatOpenAI>;
        
        mockSubscriberService = {
            updateSubscriber: jest.fn()
        } as unknown as jest.Mocked<SubscriberService>;
        
        graph = createOnboardingGraph(mockLlm, mockSubscriberService);
    });

    it("should update context when collecting info", async () => {
        const initialState: AgentState = {
            messages: [new HumanMessage("I speak English")],
            subscriber: { connections: { phone: "123" }, status: 'onboarding' } as any,
            activeMode: "conversation", // Usually handled by router, but graph execution doesn't care
            subgraphState: undefined
        };

        // Mock LLM to update context
        const toolCallMsg = new AIMessage({
            content: "",
            tool_calls: [{
                name: "update_onboarding_context",
                args: { nativeLanguage: "English" },
                id: "call_1"
            }]
        });
        const textMsg = new AIMessage("What is your target language?");
        
        mockLlm.invoke
            .mockResolvedValueOnce(toolCallMsg)
            .mockResolvedValueOnce(textMsg);

        const result = await graph.invoke(initialState);
        
        expect(result.subgraphState).toBeDefined();
        expect(result.subgraphState?.context).toEqual({ nativeLanguage: "English" });
        // Messages: Human -> AI(Tool) -> AI(Text)
        // Wait, 'update_context' node preserves history? 
        // onboarding_agent adds the tool response.
        // Then it loops.
        // Next onboarding_agent call adds text response.
        // So subgraphState.messages should have length 3 (Human, AI-Tool, AI-Text)
        expect(result.subgraphState?.messages).toHaveLength(3); 
    });

    it("should finalize onboarding when complete", async () => {
        const previousContext = {
            nativeLanguage: "English",
            targetLanguage: "Spanish",
            name: "John",
            timezone: "UTC",
            referralSource: "Friend",
            assessedLevel: "A1"
        };
        
        const previousMessages = [
            new HumanMessage("I am A1"),
            new AIMessage({ content: "", tool_calls: [{ name: "update_onboarding_context", args: { assessedLevel: "A1" }, id: "call_old" }] })
        ];

        const initialState: AgentState = {
            messages: [...previousMessages],
            subscriber: { connections: { phone: "123" }, profile: { name: "New User" }, status: 'onboarding' } as any,
            activeMode: "conversation",
            subgraphState: {
                messages: previousMessages,
                context: previousContext
            }
        };

        // Mock LLM to complete onboarding
        // The LLM sees full context and calls complete_onboarding
        const toolCallMsg = new AIMessage({
            content: "",
            tool_calls: [{
                name: "complete_onboarding",
                args: { summary: "Welcome John!" },
                id: "call_final"
            }]
        });
        mockLlm.invoke.mockResolvedValue(toolCallMsg);

        const result = await graph.invoke(initialState);
        
        expect(mockSubscriberService.updateSubscriber).toHaveBeenCalledWith("123", expect.objectContaining({
            status: "active",
            profile: expect.objectContaining({ name: "John" })
        }));

        expect(result.activeMode).toBe("conversation");
        expect(result.subgraphState).toBeNull();
        const lastMsg = result.messages[result.messages.length - 1];
        expect(lastMsg.content).toBe("Welcome John!");
    });
});
