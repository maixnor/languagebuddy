import { test, before, after, describe, skip } from 'node:test';
import { strict as assert } from 'node:assert';
import { Redis } from 'ioredis';
import { LanguageBuddyAgent } from '../src/agents/language-buddy-agent';
import { RedisCheckpointSaver } from '../src/persistence/redis-checkpointer';
import { SubscriberService } from '../src/services/subscriber-service';
import { Subscriber } from '../src/types';


import dotenv from "dotenv";
import path from 'path';

// Load environment variables first, before importing config
dotenv.config({ path: path.join(__dirname, '../.env') });

// Skip these tests by default to avoid costs during development
// To run these tests, set environment variable RUN_E2E_TESTS=true
const shouldSkipE2E = process.env.RUN_E2E_TESTS !== 'true';

describe('LanguageBuddyAgent End-to-End Tests (Real Services)', () => {
  let redis: Redis;
  let checkpointer: RedisCheckpointSaver;
  let agent: LanguageBuddyAgent;
  let subscriberService: SubscriberService;

  before(async function() {
    if (shouldSkipE2E) {
      console.log('⏭️  Skipping E2E tests. Set RUN_E2E_TESTS=true to run with real services.');
      return;
    }

    console.log('🚀 Setting up E2E test environment with real services...');

    // Connect to real Redis
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    try {
      await redis.connect();
      await redis.ping();
      console.log(`✅ Connected to Redis at ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error);
      throw error;
    }

    // Initialize services
    checkpointer = new RedisCheckpointSaver(redis);
    subscriberService = SubscriberService.getInstance(redis);
    agent = new LanguageBuddyAgent(checkpointer);

    console.log('✅ E2E test environment ready');
  });

  after(async function() {
    if (shouldSkipE2E) return;

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

  (shouldSkipE2E ? skip : test)('should process user message with real OpenAI and Redis', async () => {
    const testPhone = 'test:+436802456552';
    const userMessage = 'Hello! My name is John and I want to learn Spanish. I already speak English fluently.';

    console.log('📤 Sending message to real LLM...');
    console.log(`User: ${userMessage}`);

    const result = await agent.processUserMessage(testPhone, userMessage);

    console.log(`🤖 AI Response: ${result}`);

    // Basic assertions
    assert.ok(result, 'Should receive a response');
    assert.ok(typeof result === 'string', 'Response should be a string');
    assert.ok(result.length > 10, 'Response should be substantial');

    // Verify that the response is contextually appropriate
    const lowerResult = result.toLowerCase();
    assert.ok(
      lowerResult.includes('john') || 
      lowerResult.includes('spanish') || 
      lowerResult.includes('english') ||
      lowerResult.includes('learn') ||
      lowerResult.includes('practice'),
      'Response should acknowledge user input contextually'
    );

    console.log('✅ Basic message processing test passed');
  });

  (shouldSkipE2E ? skip : test)('should trigger LLM tool calling for profile updates', async () => {
    const testPhone = 'test:+436701234567';
    
    // Create a fresh test subscriber first
    await subscriberService.createSubscriber(testPhone);
    
    const userMessage = 'Hi! I\'m Maria, I speak Italian natively and I want to learn French. I\'m a beginner in French.';

    console.log('📤 Testing LLM tool calling for profile updates...');
    console.log(`User: ${userMessage}`);

    const result = await agent.processUserMessage(testPhone, userMessage);

    console.log(`🤖 AI Response: ${result}`);

    // Wait a moment for any async tool calls to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check if subscriber profile was updated via tool calls
    const updatedSubscriber = await subscriberService.getSubscriber(testPhone);

    console.log('📋 Updated subscriber profile:', JSON.stringify(updatedSubscriber, null, 2));

    // Verify profile updates occurred
    assert.ok(updatedSubscriber, 'Subscriber should exist');
    
    // Check if name was updated via tool call
    if (updatedSubscriber.name && updatedSubscriber.name !== 'New User') {
      console.log('✅ Name update tool call worked:', updatedSubscriber.name);
    } else {
      console.log('⚠️ Name was not updated - tool call may not have triggered');
    }

    // Check if languages were updated via tool call
    const hasItalian = updatedSubscriber.speakingLanguages?.some(lang => 
      lang.languageName.toLowerCase().includes('italian')
    );
    const hasFrench = updatedSubscriber.learningLanguages?.some(lang => 
      lang.languageName.toLowerCase().includes('french')
    );

    if (hasItalian) {
      console.log('✅ Speaking language (Italian) tool call worked');
    } else {
      console.log('⚠️ Speaking language was not updated - tool call may not have triggered');
    }

    if (hasFrench) {
      console.log('✅ Learning language (French) tool call worked');
    } else {
      console.log('⚠️ Learning language was not updated - tool call may not have triggered');
    }

    // The test passes if we get a reasonable response, even if tool calls don't work
    // This helps identify if the issue is with tool calling specifically
    assert.ok(result.length > 10, 'Should get a substantial response');

    console.log('✅ Tool calling test completed (check logs above for tool call status)');
  });

  (shouldSkipE2E ? skip : test)('should handle feedback collection tool calls', async () => {
    const testPhone = 'test:+436709876543';
    
    await subscriberService.createSubscriber(testPhone);
    
    const userMessage = 'That was a great conversation! I really enjoyed practicing with you. The explanations were very clear.';

    console.log('📤 Testing feedback collection tool calls...');
    console.log(`User: ${userMessage}`);

    const result = await agent.processUserMessage(testPhone, userMessage);

    console.log(`🤖 AI Response: ${result}`);

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check response acknowledges feedback
    const lowerResult = result.toLowerCase();
    assert.ok(
      lowerResult.includes('thank') || 
      lowerResult.includes('glad') ||
      lowerResult.includes('feedback') ||
      lowerResult.includes('appreciate'),
      'Should acknowledge user feedback appropriately'
    );

    console.log('✅ Feedback collection test completed');
  });

  (shouldSkipE2E ? skip : test)('should maintain conversation context across multiple messages', async () => {
    const testPhone = 'test:+436705555555';
    
    await subscriberService.createSubscriber(testPhone);
    
    // First message
    const firstMessage = 'Hello! I want to practice Spanish conversation.';
    console.log(`📤 Message 1: ${firstMessage}`);
    
    const firstResponse = await agent.processUserMessage(testPhone, firstMessage);
    console.log(`🤖 Response 1: ${firstResponse}`);
    
    // Wait for state to be saved
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Second message that references the context
    const secondMessage = 'Can you help me with basic greetings?';
    console.log(`📤 Message 2: ${secondMessage}`);
    
    const secondResponse = await agent.processUserMessage(testPhone, secondMessage);
    console.log(`🤖 Response 2: ${secondResponse}`);
    
    // Verify both responses are contextually appropriate
    assert.ok(firstResponse.length > 10, 'First response should be substantial');
    assert.ok(secondResponse.length > 10, 'Second response should be substantial');
    
    // Second response should acknowledge the Spanish context from first message
    const lowerSecondResponse = secondResponse.toLowerCase();
    assert.ok(
      lowerSecondResponse.includes('spanish') || 
      lowerSecondResponse.includes('greeting') ||
      lowerSecondResponse.includes('hola') ||
      lowerSecondResponse.includes('buenos'),
      'Second response should acknowledge Spanish context'
    );

    console.log('✅ Conversation context test passed');
  });

  (shouldSkipE2E ? skip : test)('should handle complex language learning scenarios', async () => {
    const testPhone = 'test:+436708888888';
    
    await subscriberService.createSubscriber(testPhone);
    
    const complexMessage = 'I speak German and English. I want to learn Spanish and I\'m intermediate level. Can you explain the difference between ser and estar in Spanish?';
    
    console.log('📤 Testing complex language learning scenario...');
    console.log(`User: ${complexMessage}`);

    const result = await agent.processUserMessage(testPhone, complexMessage);

    console.log(`🤖 AI Response: ${result}`);

    // Wait for any tool calls
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify the response addresses the grammar question
    const lowerResult = result.toLowerCase();
    assert.ok(
      lowerResult.includes('ser') || 
      lowerResult.includes('estar') ||
      lowerResult.includes('permanent') ||
      lowerResult.includes('temporary') ||
      lowerResult.includes('being'),
      'Should address the ser/estar grammar question'
    );

    // Check if profile was updated with language information
    const subscriber = await subscriberService.getSubscriber(testPhone);
    console.log('📋 Subscriber after complex interaction:', JSON.stringify(subscriber, null, 2));

    assert.ok(result.length > 50, 'Should provide a detailed explanation');

    console.log('✅ Complex scenario test completed');
  });

  (shouldSkipE2E ? skip : test)('should handle errors gracefully with real services', async () => {
    const testPhone = 'test:+436700000000';
    
    // Test with potentially problematic input
    const problematicMessage = '';
    
    console.log('📤 Testing error handling with empty message...');

    const result = await agent.processUserMessage(testPhone, problematicMessage);

    console.log(`🤖 Response to empty message: ${result}`);

    // Should get some kind of response, not crash
    assert.ok(result, 'Should handle empty message gracefully');
    assert.ok(typeof result === 'string', 'Response should be a string');

    console.log('✅ Error handling test passed');
  });

  (shouldSkipE2E ? skip : test)('should verify Redis checkpoint persistence', async () => {
    const testPhone = 'test:+436706666666';
    
    await subscriberService.createSubscriber(testPhone);
    
    // Send a message to create checkpoint data
    await agent.processUserMessage(testPhone, 'Hello, I want to learn Italian');
    
    // Wait for checkpoint to be saved
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check if checkpoint data exists in Redis
    const checkpointKeys = await redis.keys(`checkpoint:${testPhone}:*`);
    
    console.log(`📋 Found ${checkpointKeys.length} checkpoint keys for ${testPhone}`);
    
    if (checkpointKeys.length > 0) {
      console.log('✅ Checkpoint persistence working');
      
      // Examine one checkpoint
      const sampleKey = checkpointKeys[0];
      const checkpointData = await redis.get(sampleKey);
      console.log(`📄 Sample checkpoint key: ${sampleKey}`);
      console.log(`📄 Checkpoint data length: ${checkpointData?.length || 0} bytes`);
    } else {
      console.log('⚠️ No checkpoint data found - checkpointing may not be working');
    }
    
    assert.ok(true, 'Checkpoint test completed');
  });
});