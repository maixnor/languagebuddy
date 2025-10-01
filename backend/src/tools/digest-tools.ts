import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from '../config';
import { getContextVariable } from "@langchain/core/context";
import { SubscriberService } from '../services/subscriber-service';
import { DigestService } from '../services/digest-service';

let subscriberService: SubscriberService;
let digestService: DigestService;

export function initializeDigestTools(
  subscriberServiceInstance: SubscriberService,
  digestServiceInstance: DigestService
) {
  subscriberService = subscriberServiceInstance;
  digestService = digestServiceInstance;
}

export const createDigestTool: DynamicStructuredTool = new DynamicStructuredTool({
  name: "create_conversation_digest",
  description: "Create a digest of the current conversation to capture learning progress, vocabulary, and user insights",
  schema: z.object({
    reason: z.string().optional().describe("Optional reason for creating the digest (e.g., 'end of session', 'user breakthrough', etc.)")
  }),
  func: async (input) => {
    const phoneNumber = getContextVariable('phone') as string;
    if (!phoneNumber) {
      logger.error("Phone number not found in context");
      return "Phone number is required to create digest";
    }

    try {
      const subscriber = await subscriberService.getSubscriber(phoneNumber);
      if (!subscriber) {
        return "Subscriber not found";
      }

      const digest = await digestService.createConversationDigest(subscriber);
      
      const reason = input.reason ? ` (${input.reason})` : '';
      logger.info({ phoneNumber, reason }, "Digest created via tool");
      
      return `Conversation digest created successfully${reason}! I've captured the key learning points, vocabulary, and insights from our conversation for future reference.`;
      
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error creating digest via tool");
      return "I encountered an error while creating the conversation digest. Please try again later.";
    }
  }
});

export const digestTools = [
  createDigestTool,
];
