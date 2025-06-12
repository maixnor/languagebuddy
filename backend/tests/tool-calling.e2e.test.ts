import { test, before, after, describe } from 'node:test';
import { Redis } from 'ioredis';
import { RedisCheckpointSaver } from '../src/persistence/redis-checkpointer';
import { SubscriberService } from '../src/services/subscriber-service';
import {HumanMessage, SystemMessage} from "@langchain/core/messages";
import {ChatOpenAI} from "@langchain/openai";
import {collectFeedbackTool } from "../src/tools/feedback-tools";
import {createReactAgent} from "@langchain/langgraph/prebuilt";
import dotenv from "dotenv";
import path from "path";
import assert = require("node:assert");
import {FeedbackService} from "../src/services/feedback-service";
import {updateSubscriberTool} from "../src/tools/subscriber-tools";
import {setContextVariable} from "@langchain/core/context";

dotenv.config({ path: path.join(__dirname, '../.env') });

describe('WTF how does tool calling work?', () => {
  let redis: Redis;
  let checkpointer: RedisCheckpointSaver;
  let subscriberService: SubscriberService;
  let feedbackService: FeedbackService;
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
    feedbackService = FeedbackService.getInstance(redis);
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

  test('should call the subscriber tool and update the redis record', async () => {
    console.log('🔍 Starting tool calling test...');
    const userMessage = 'Ich versuche gerade Spanisch zu lernen. Ich bin gerade so mittendrin. Ich brauche Hilfe bei Grammatik und Vokabeln.';

    let subscriber = await subscriberService.getSubscriber(testPhone);
    if (!subscriber) {
      console.warn('Creating new subscriber for test phone:', testPhone);
      subscriber = await subscriberService.createSubscriber(testPhone);
    }

    const llm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 1000,
    });

    const agent = createReactAgent({
      llm: llm,
      tools: [updateSubscriberTool, collectFeedbackTool],
      checkpointer: checkpointer,
    })

    setContextVariable('phone', subscriber.phone);
    const response = await agent.invoke(
      { messages: [new SystemMessage(subscriberService.getSystemPrompt(subscriber)), new HumanMessage(userMessage)] },
      { configurable: { thread_id: testPhone} }
    );

    console.log('🔧 AI response:', response.messages.pop().text);

    const updatedSubscriber = await subscriberService.getSubscriber(testPhone);
    assert.notEqual(updatedSubscriber, subscriber);

    console.log('✅ Basic message processing test passed');
  });

});

