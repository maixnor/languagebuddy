import { createOnboardingGraph } from "./onboarding.graph";
import { ChatOpenAI } from "@langchain/openai";
import { SubscriberService } from "../subscriber/subscriber.service";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
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

    it("should maintain conversation history in subgraphState", async () => {
        const initialState: AgentState = {
            messages: [new HumanMessage("I speak English")],
            subscriber: { connections: { phone: "123" }, status: 'onboarding' } as any,
            activeMode: "conversation", 
            subgraphState: undefined
        };

        // Mock LLM to return a text response (question)
        const textMsg = new AIMessage("What is your target language?");
        
        mockLlm.invoke.mockResolvedValueOnce(textMsg);

        const result = await graph.invoke(initialState);
        
        expect(result.subgraphState).toBeDefined();
        // Should have HumanMessage and AIMessage
        expect(result.subgraphState?.messages).toHaveLength(2);
        expect(result.subgraphState?.messages[0].content).toBe("I speak English");
        expect(result.subgraphState?.messages[1].content).toBe("What is your target language?");
        
        // Also the response should be in the main messages
        expect(result.messages).toContain(textMsg);
    });

    it("should finalize onboarding when tool is called with all fields", async () => {
        const previousMessages = [
            new HumanMessage({ content: "My name is John", id: "msg1" }),
            new AIMessage({ content: "Hi John!", id: "msg2" }),
            new HumanMessage({ content: "I want to learn Spanish", id: "msg3" })
        ];

        const initialState: AgentState = {
            // Only msg3 is in the main state for this turn (simulating new message arrival)
            // But usually main state accumulates. If we simulate a full run, it would have all?
            // Let's assume the main messages channel has msg1, msg2, msg3
            messages: [
                new HumanMessage({ content: "My name is John", id: "msg1" }),
                new AIMessage({ content: "Hi John!", id: "msg2" }),
                new HumanMessage({ content: "I want to learn Spanish", id: "msg3" })
            ],
            subscriber: { connections: { phone: "123" }, profile: { name: "Temp" }, status: 'onboarding' } as any,
            activeMode: "conversation",
            subgraphState: {
                messages: previousMessages,
            }
        };

        // Mock LLM to call finalize_onboarding
        const toolCallMsg = new AIMessage({
            content: "",
            tool_calls: [{
                name: "finalize_onboarding",
                args: { 
                    name: "John",
                    nativeLanguage: "English",
                    targetLanguage: "Spanish",
                    learningGoal: "Travel",
                    timezone: "UTC",
                    interests: ["Football", "Cooking"],
                    assessedLevel: "A1",
                    summary: "Welcome aboard!"
                },
                id: "call_final"
            }]
        });
        mockLlm.invoke.mockResolvedValue(toolCallMsg);

        const result = await graph.invoke(initialState);
        
        // Check DB update
        expect(mockSubscriberService.updateSubscriber).toHaveBeenCalledWith("123", expect.objectContaining({
            status: "active",
            profile: expect.objectContaining({
                name: "John",
                timezone: "UTC",
                interests: ["Football", "Cooking"],
                speakingLanguages: expect.arrayContaining([
                    expect.objectContaining({ languageName: "English" })
                ]),
                learningLanguages: expect.arrayContaining([
                    expect.objectContaining({ 
                        languageName: "Spanish",
                        motivationFactors: ["Travel"]
                    })
                ])
            })
        }));

        // Check result state
        expect(result.activeMode).toBe("conversation");
        expect(result.subgraphState).toBeNull();
        
        // Should contain summary
        const lastMsg = result.messages[result.messages.length - 1];
        expect(lastMsg.content).toBe("Welcome aboard!");

        // Verify that old messages are removed from the state
        // RemoveMessage reducer action removes them from the list, so they should not be present.
        const remainingIds = result.messages.map(m => m.id);
        expect(remainingIds).not.toContain("msg1");
        expect(remainingIds).not.toContain("msg2");
        expect(remainingIds).not.toContain("msg3");
    });

    it("should use the generated system prompt", async () => {
        const initialState: AgentState = {
            messages: [new HumanMessage("Hello")],
            subscriber: { connections: { phone: "123" }, status: 'onboarding' } as any,
            activeMode: "conversation",
            subgraphState: undefined
        };

        mockLlm.invoke.mockResolvedValue(new AIMessage("Hello!"));

        await graph.invoke(initialState);

        const firstCallArgs = mockLlm.invoke.mock.calls[0][0];
        const systemMsg = firstCallArgs.find(m => m instanceof SystemMessage);
        
        expect(systemMsg).toBeDefined();
        // Check for key phrases from the new prompt
        expect(systemMsg?.content).toContain("Proficiency Level");
        expect(systemMsg?.content).toContain("finalize_onboarding");
        expect(systemMsg?.content).toContain("Maya");
    });
});