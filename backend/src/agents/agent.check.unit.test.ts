import { checkLastResponse } from './agent.check';

import { ChatOpenAI } from '@langchain/openai';
import { Checkpoint } from '@langchain/langgraph-checkpoint';
import { Subscriber } from '../features/subscriber/subscriber.types';
import { HumanMessage, AIMessage } from "@langchain/core/messages";

jest.mock('../core/persistence/sqlite-checkpointer');
jest.mock('@langchain/openai');

describe('checkLastResponse (standalone)', () => {
  let mockCheckpointer: jest.Mocked<any>;
  let mockLlm: jest.Mocked<ChatOpenAI>;
  let mockStructuredLlm: { invoke: jest.Mock };

  const mockSubscriber: Subscriber = {
    profile: {
      name: "Test User",
      speakingLanguages: [],
      learningLanguages: [{ languageName: "Spanish", overallLevel: "A1", skillAssessments: [], deficiencies: [], firstEncountered: new Date(), lastPracticed: new Date(), totalPracticeTime: 0, confidenceScore: 50, isTarget: true }],
      timezone: "UTC"
    } as any,
    connections: {
      phone: "+1234567890",
    },
    metadata: {} as any,
    isPremium: false,
    signedUpAt: new Date().toISOString(),
  };

  beforeEach(() => {
    mockCheckpointer = {
        get: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
    } as jest.Mocked<any>;
    
    // Mock Structured LLM
    mockStructuredLlm = { invoke: jest.fn() };
    mockLlm = {
        withStructuredOutput: jest.fn().mockReturnValue(mockStructuredLlm)
    } as any;
    
    // Default empty checkpoint
    mockCheckpointer.get.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return message if no history found', async () => {
    const result = await checkLastResponse(mockSubscriber, mockLlm, mockCheckpointer);
    expect(result).toContain("can't check anything yet");
  });

  it('should identify no mistake (OK status)', async () => {
    // Setup history
    const history = [new HumanMessage("Hola"), new AIMessage("Hola, ¿cómo estás?")];
    const checkpoint: Checkpoint = {
      v: 1, // Add version
      id: '1', ts: new Date().toISOString(), channel_versions: {}, versions_seen: {},
      values: { messages: history }
    };
    mockCheckpointer.get.mockResolvedValue({
      config: {}, checkpoint, metadata: {}, parentConfig: {}
    });

    // Mock structured response (OK)
    mockStructuredLlm.invoke.mockResolvedValue({
      status: "OK",
      user_response: "Los saludos son correctos. ¡Buen trabajo!"
    });

    const result = await checkLastResponse(mockSubscriber, mockLlm, mockCheckpointer);
    
    expect(result).toContain("Los saludos son correctos");
    expect(result).toContain("✅");
    expect(mockCheckpointer.put).not.toHaveBeenCalled(); // No correction injected
  });

  it('should identify mistake and inject correction', async () => {
    // Setup history
    const history = [new HumanMessage("Where is the Eiffel Tower?"), new AIMessage("It is in Berlin.")];
    const checkpoint: Checkpoint = {
      v: 1, // Add version
      id: '1', ts: new Date().toISOString(), channel_versions: {}, versions_seen: {},
      values: { messages: history }
    };
    mockCheckpointer.get.mockResolvedValue({
      config: {}, checkpoint, metadata: {}, parentConfig: {}
    });

    // Mock structured response (ERROR)
    mockStructuredLlm.invoke.mockResolvedValue({
      status: "ERROR",
      user_response: "Actually, the Eiffel Tower is in Paris, not Berlin.",
      system_correction: "The Eiffel Tower is in Paris. Never say it is in Berlin."
    });

    const result = await checkLastResponse(mockSubscriber, mockLlm, mockCheckpointer);
    
    expect(result).toContain("Actually, the Eiffel Tower is in Paris");
    expect(result).toContain("⚠️");
    
    // Verify injection
    expect(mockCheckpointer.put).toHaveBeenCalledWith(
      expect.anything(), // config
      expect.objectContaining({
        id: '1',
        ts: expect.any(String),
        v: 1,
        channel_versions: {},
        versions_seen: {},
        values: expect.objectContaining({
          messages: expect.arrayContaining([
            expect.any(HumanMessage),
            expect.any(AIMessage),
            expect.objectContaining({ content: expect.stringContaining("SYSTEM CORRECTION") })
          ])
        })
      }),
      expect.anything(), // parentConfig
      undefined
    );
  });

  it('should handle agent execution errors', async () => {
     // Setup history
     const history = [new HumanMessage("Hi"), new AIMessage("Hi")];
     const checkpoint: Checkpoint = {
         v: 1, // Add version
         id: '1', ts: new Date().toISOString(), channel_versions: {}, versions_seen: {},
         values: { messages: history }
     };
     mockCheckpointer.get.mockResolvedValue({
         config: {}, checkpoint, metadata: {}, parentConfig: {}
     });
 
     // Mock error
     mockStructuredLlm.invoke.mockRejectedValue(new Error("LLM error"));
 
     const result = await checkLastResponse(mockSubscriber, mockLlm, mockCheckpointer);
     expect(result).toContain("error occurred while performing the check");
  });
});
