import { test, before, after, describe, skip } from 'node:test';
import { Redis } from 'ioredis';
import {ConversationStateAnnotation, LanguageBuddyAgent} from '../src/agents/language-buddy-agent';
import { RedisCheckpointSaver } from '../src/persistence/redis-checkpointer';
import { SubscriberService } from '../src/services/subscriber-service';
import {ConversationState, Subscriber} from '../src/types';
import {BaseMessage, HumanMessage} from "@langchain/core/messages";
import {ChatOpenAI} from "@langchain/openai";
import {config} from "../src/config";
import {collectFeedbackTool, updateSubscriberTool} from "../src/tools/conversation-tools";
import {END, START, StateGraph} from "@langchain/langgraph";
import {createReactAgent} from "@langchain/langgraph/prebuilt";
import dotenv from "dotenv";
import path from "path";
import {RunnableLambda} from "@langchain/core/runnables";
import {BaseChatModel} from "@langchain/core/dist/language_models/chat_models";
import {setContextVariable} from "@langchain/core/context";
import { ToolCall } from '@langchain/core/dist/messages/tool';
import assert = require("node:assert");

dotenv.config({ path: path.join(__dirname, '../.env') });

describe('WTF how does tool calling work?', () => {
  let redis: Redis;
  let checkpointer: RedisCheckpointSaver;
  let subscriberService: SubscriberService;
  let testPhone = '436804206969';

  before(async function() {
    // Connect to real Redis
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      tls: {},
    });

    try {
      await redis.ping();
      console.log(`✅ Connected to Redis at ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error);
      throw error;
    }

    // Initialize services
    checkpointer = new RedisCheckpointSaver(redis);
    subscriberService = SubscriberService.getInstance(redis);
  });

  after(async function() {
    console.log('🧹 Cleaning up E2E test environment...');
    try {
      if (redis) {
        // Clean up test data
        const testKeys = await redis.keys('test:*');
        if (testKeys.length > 0) {
          await redis.del(...testKeys);
        }
        await redis.quit();
        console.log('✅ Redis cleanup complete');
      }
    } catch (error) {
      console.warn('⚠️ Cleanup warning:', error.message);
    }
  });

  const lambda = RunnableLambda.from(
      async (params: { phone: string; query: string; llm: BaseChatModel }) => {
        const { phone, query, llm } = params;
        if (!llm.bindTools) {
          throw new Error("Language model does not support tools.");
        }
        // Set a context variable accessible to any child runnables called within this one.
        // You can also set context variables at top level that act as globals.
        setContextVariable("phone", phone);
        console.log(`📞 Phone number set to: ${phone}`);
        const tools = [updateSubscriberTool];
        const llmWithTools = llm.bindTools(tools);
        const modelResponse = await llmWithTools.invoke(query);

        if (modelResponse.tool_calls.length > 0) {
          for (const item of modelResponse.tool_calls) {
            return updateSubscriberTool.invoke(item);
          }
        } else {
          return "No tool invoked.";
        }
        return "nothing happened at all";
      }
  );

  test('should call the subscriber tool and update the redis record', async () => {
    console.log('🔍 Starting tool calling test...');
    const userMessage = 'Hello my name is John and I want to learn Spanish. Im quite the beginner in spanish. I already speak English fluently';

    let subscriber = await subscriberService.getSubscriber(testPhone);
    if (!subscriber) {
      console.warn('Creating new subscriber for test phone:', testPhone);
      subscriber = await subscriberService.createSubscriber(testPhone);
    }

    const llm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: config.openai.maxTokens,
    });

    const response = await lambda.invoke({
      query: userMessage,
      phone: testPhone,
      llm: llm,
    })
    console.log(response);

    const updatedSubscriber = await subscriberService.getSubscriber(testPhone);
    assert.notEqual(updatedSubscriber, subscriber);

    console.log('✅ Basic message processing test passed');
  });

});

