import { createFeedbackGraph } from "./feedback.graph";
import { ChatOpenAI } from "@langchain/openai";
import { FeedbackService } from "./feedback.service";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { AgentState } from "../../agents/agent.types";

jest.mock("@langchain/openai");
jest.mock("./feedback.service");

describe("Feedback Subgraph", () => {
    let mockLlm: jest.Mocked<ChatOpenAI>;
    let mockFeedbackService: jest.Mocked<FeedbackService>;
    let graph: any;

    beforeEach(() => {
        mockLlm = {
            bindTools: jest.fn().mockReturnThis(),
            invoke: jest.fn()
        } as unknown as jest.Mocked<ChatOpenAI>;
        
        mockFeedbackService = {
            saveFeedback: jest.fn()
        } as unknown as jest.Mocked<FeedbackService>;
        
        graph = createFeedbackGraph(mockLlm, mockFeedbackService);
    });

    it("should accumulate messages in subgraphState during feedback collection", async () => {
        // Setup initial state: User wants to give feedback
        const initialState: AgentState = {
            messages: [new HumanMessage("I want to give feedback")],
            subscriber: { connections: { phone: "123" } } as any,
            activeMode: "feedback",
            subgraphState: undefined
        };

        // Mock LLM to ask a question
        mockLlm.invoke.mockResolvedValue(new AIMessage("What is your feedback?"));

        // Run graph
        const result = await graph.invoke(initialState);
        
        expect(result.subgraphState).toBeDefined();
        // The HumanMessage is added to subgraphState + The AI Response
        expect(result.subgraphState?.messages).toHaveLength(2); 
        expect(result.subgraphState?.messages[1].content).toBe("What is your feedback?");
        
        // The AI response is also appended to main messages
        expect(result.messages).toHaveLength(2);
        expect(result.messages[1].content).toBe("What is your feedback?");
    });

    it("should save feedback and clear state when tool is called", async () => {
        // Setup state: User provided feedback
        const previousMessages = [
            new HumanMessage("I want to give feedback"),
            new AIMessage("What is your feedback?")
        ];
        
        const userInput = new HumanMessage("The app is slow.");
        
        const initialState: AgentState = {
            messages: [...previousMessages, userInput],
            subscriber: { connections: { phone: "123" } } as any,
            activeMode: "feedback",
            subgraphState: {
                messages: previousMessages,
                context: {}
            }
        };

        // Mock LLM to call submit_feedback
        const toolCallMsg = new AIMessage({
            content: "",
            tool_calls: [{
                name: "submit_feedback",
                args: {
                    summary: "App is slow",
                    sentiment: "negative",
                    category: "technical",
                    actionItems: ["Optimization"]
                },
                id: "call_1"
            }]
        });
        mockLlm.invoke.mockResolvedValue(toolCallMsg);

        const result = await graph.invoke(initialState);
        
        expect(mockFeedbackService.saveFeedback).toHaveBeenCalledWith(expect.objectContaining({
            userFeedback: "App is slow"
        }));
        
        expect(result.activeMode).toBe("conversation");
        expect(result.subgraphState).toBeNull();
        
        const lastMsg = result.messages[result.messages.length - 1];
        expect(lastMsg.content).toContain("(Feedback System) User provided feedback");
    });
});
