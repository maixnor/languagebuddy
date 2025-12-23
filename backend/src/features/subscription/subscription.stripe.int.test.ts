/**
 * Integration tests for Stripe service
 * Tests with MOCKED Stripe API to catch bugs in:
 * - Customer search edge cases
 * - Active subscription checks
 * - Error handling
 * - Missing customers
 * - Multiple subscriptions
 * - Payment link generation
 */

import { SubscriptionService } from './subscription.service';
import { SubscriberService } from '../subscriber/subscriber.service';
import { StripeWebhookService } from './subscription-webhook.service';
import Stripe from 'stripe';

import { config } from '../../core/config';
import { DatabaseService } from '../../core/database';

// Mock Stripe
jest.mock('stripe');

describe('SubscriptionService & StripeWebhookService - Integration Tests', () => {

  let dbService: DatabaseService; // Declared dbService
  let subscriptionService: SubscriptionService;
  let subscriberService: SubscriberService;
  let stripeWebhookService: StripeWebhookService;
  let mockStripe: jest.Mocked<Stripe>;
  const testPhone = '+1234567890';
  const testPhoneWithPlus = '+1234567890';
  const testWebhookSecret = 'wh_test_secret';

  beforeAll(() => {
    dbService = new DatabaseService(':memory:'); // Initialize dbService
    dbService.migrate(); // Apply migrations
  });

  afterAll(async () => {
    dbService.close(); // Close dbService
  });

  beforeEach(async () => {
    // Clear tables for a clean state before each test (SQLite)
    dbService.getDb().exec('DELETE FROM subscribers');
    dbService.getDb().exec('DELETE FROM daily_usage');
    dbService.getDb().exec('DELETE FROM checkpoints');
    dbService.getDb().exec('DELETE FROM checkpoint_writes');
    dbService.getDb().exec('DELETE FROM feedback');
    dbService.getDb().exec('DELETE FROM processed_messages');



    // Explicitly set config values for Stripe, ensuring they are available to StripeService
    (config.stripe as any).secretKey = 'sk_test_123';
    (config.stripe as any).webhookSecret = testWebhookSecret;

    // Reset singletons
    (SubscriptionService as any).instance = null;
    (SubscriberService as any).instance = null;

    subscriptionService = SubscriptionService.getInstance();
    // Initialize StripeService with the dummy API key from config
    subscriptionService.initialize(config.stripe.secretKey);
    
    subscriberService = SubscriberService.getInstance(dbService); // Pass dbService
    stripeWebhookService = new StripeWebhookService(
      subscriberService,
      subscriptionService,
      config.stripe.webhookSecret! // Use config.stripe.webhookSecret
    );

    // Create mock Stripe instance
    mockStripe = {
      customers: {
        search: jest.fn(),
        retrieve: jest.fn(), // Added retrieve
      } as any,
      subscriptions: {
        list: jest.fn(),
      } as any,
      webhooks: {
        constructEvent: jest.fn(),
      } as any,
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({
            url: 'https://checkout.stripe.com/test-session-url',
          }),
        },
      } as any,
    } as any;

    // Initialize StripeService with mock
    (subscriptionService as any).stripe = mockStripe;

  });



  describe('initialize()', () => {
    it('should set stripe to null if no API key provided', () => {
      const service = SubscriptionService.getInstance();
      service.initialize('');
      
      expect((service as any).stripe).toBeNull();
    });

    it('should initialize Stripe with valid API key', () => {
      const service = SubscriptionService.getInstance();
      service.initialize('sk_test_12345');
      
      // Stripe should be initialized (mocked in real tests)
      expect((service as any).stripe).toBeDefined();
    });
  });

  describe('checkSubscription()', () => {
    it('should return false if Stripe is not initialized', async () => {
      (subscriptionService as any).stripe = null;
      
      const result = await subscriptionService.checkSubscription(testPhone);
      
      // When Stripe is not initialized, checkSubscription should return false
      expect(result).toBe(false);
    });

    it('should find customer with phone number and active subscription', async () => {
      const mockCustomer = {
        id: 'cus_123',
        phone: testPhoneWithPlus,
      };

      const mockSubscription = {
        id: 'sub_123',
        status: 'active',
        customer: 'cus_123',
      };

      mockStripe.customers.search.mockResolvedValue({
        data: [mockCustomer],
      } as any);

      mockStripe.subscriptions.list.mockResolvedValue({
        data: [mockSubscription],
      } as any);

      const result = await subscriptionService.checkSubscription(testPhone);
      
      expect(result).toBe(true);
      expect(mockStripe.customers.search).toHaveBeenCalledWith({
        limit: 1,
        query: `phone:'${testPhoneWithPlus}'`,
      });
      expect(mockStripe.subscriptions.list).toHaveBeenCalledWith({
        customer: 'cus_123',
        status: 'active',
        limit: 1,
      });
    });

    it('should return false if no customer found', async () => {
      mockStripe.customers.search.mockResolvedValue({
        data: [],
      } as any);

      const result = await subscriptionService.checkSubscription(testPhone);
      
      expect(result).toBe(false);
      expect(mockStripe.subscriptions.list).not.toHaveBeenCalled();
    });

    it('should return false if customer exists but no active subscription', async () => {
      const mockCustomer = {
        id: 'cus_123',
        phone: testPhoneWithPlus,
      };

      mockStripe.customers.search.mockResolvedValue({
        data: [mockCustomer],
      } as any);

      mockStripe.subscriptions.list.mockResolvedValue({
        data: [],
      } as any);

      const result = await subscriptionService.checkSubscription(testPhone);
      
      expect(result).toBe(false);
    });

    it('should handle Stripe API errors gracefully', async () => {
      mockStripe.customers.search.mockRejectedValue(new Error('Stripe API error'));

      const result = await subscriptionService.checkSubscription(testPhone);
      
      // Should return false on error, not throw
      expect(result).toBe(false);
    });

    it('should handle multiple customers with same phone (edge case)', async () => {
      // BUG POTENTIAL: What if search returns multiple customers?
      const mockCustomers = [
        { id: 'cus_123', phone: testPhoneWithPlus },
        { id: 'cus_456', phone: testPhoneWithPlus },
      ];

      mockStripe.customers.search.mockResolvedValue({
        data: mockCustomers,
      } as any);

      mockStripe.subscriptions.list.mockResolvedValue({
        data: [{ id: 'sub_123', status: 'active' }],
      } as any);

      const result = await subscriptionService.checkSubscription(testPhone);
      
      // Should check first customer only (limit: 1)
      expect(result).toBe(true);
      expect(mockStripe.subscriptions.list).toHaveBeenCalledWith({
        customer: 'cus_123', // First customer
        status: 'active',
        limit: 1,
      });
    });

    it('should handle customer with multiple subscriptions', async () => {
      const mockCustomer = {
        id: 'cus_123',
        phone: testPhoneWithPlus,
      };

      const mockSubscriptions = [
        { id: 'sub_123', status: 'active' },
        { id: 'sub_456', status: 'active' },
      ];

      mockStripe.customers.search.mockResolvedValue({
        data: [mockCustomer],
      } as any);

      mockStripe.subscriptions.list.mockResolvedValue({
        data: mockSubscriptions,
      } as any);

      const result = await subscriptionService.checkSubscription(testPhone);
      
      // Should return true if any active subscription exists
      expect(result).toBe(true);
    });

    it('should handle customer with canceled subscription', async () => {
      const mockCustomer = {
        id: 'cus_123',
        phone: testPhoneWithPlus,
      };

      mockStripe.customers.search.mockResolvedValue({
        data: [mockCustomer],
      } as any);

      // No active subscriptions (canceled)
      mockStripe.subscriptions.list.mockResolvedValue({
        data: [],
      } as any);

      const result = await subscriptionService.checkSubscription(testPhone);
      
      expect(result).toBe(false);
    });

    it('should add plus sign to phone number in query', async () => {
      // BUG POTENTIAL: Comment says "WhatsApp phone numbers are without the plus"
      // but what if they already have it?
      
      mockStripe.customers.search.mockResolvedValue({
        data: [],
      } as any);

      await subscriptionService.checkSubscription(testPhone);
      
      expect(mockStripe.customers.search).toHaveBeenCalledWith({
        limit: 1,
        query: `phone:'+1234567890'`,
      });
    });

    it('should handle phone number already with plus sign', async () => {
      // BUG POTENTIAL: Double plus sign if phone already has it
      mockStripe.customers.search.mockResolvedValue({
        data: [],
      } as any);

      await subscriptionService.checkSubscription(testPhoneWithPlus);
      
      const call = mockStripe.customers.search.mock.calls[0][0];
      // Should have a single plus: '+1234567890'
      expect(call.query).toBe(`phone:'+1234567890'`);
    });

    it('should handle Stripe returning null/undefined customer', async () => {
      mockStripe.customers.search.mockResolvedValue({
        data: [null as any],
      } as any);

      // Should not throw
      const result = await subscriptionService.checkSubscription(testPhone);
      expect(result).toBe(false);
    });

    it('should handle Stripe returning malformed response', async () => {
      mockStripe.customers.search.mockResolvedValue({
        data: undefined as any,
      } as any);

      // Should not throw
      const result = await subscriptionService.checkSubscription(testPhone);
      expect(result).toBe(false);
    });

    it('should handle subscription with past_due status', async () => {
      const mockCustomer = {
        id: 'cus_123',
        phone: testPhoneWithPlus,
      };

      mockStripe.customers.search.mockResolvedValue({
        data: [mockCustomer],
      } as any);

      // Only searches for 'active' status, so past_due won't be found
      mockStripe.subscriptions.list.mockResolvedValue({
        data: [],
      } as any);

      const result = await subscriptionService.checkSubscription(testPhone);
      
      // BUG POTENTIAL: Should past_due be considered valid?
      expect(result).toBe(false);
      expect(mockStripe.subscriptions.list).toHaveBeenCalledWith({
        customer: 'cus_123',
        status: 'active', // Only checking 'active', not 'past_due' or 'trialing'
        limit: 1,
      });
    });

    it('should handle network timeout gracefully', async () => {
      const timeoutError = new Error('Request timeout');
      (timeoutError as any).code = 'ETIMEDOUT';
      
      mockStripe.customers.search.mockRejectedValue(timeoutError);

      const result = await subscriptionService.checkSubscription(testPhone);
      
      expect(result).toBe(false);
    });

    it('should handle Stripe rate limiting', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).statusCode = 429;
      
      mockStripe.customers.search.mockRejectedValue(rateLimitError);

      const result = await subscriptionService.checkSubscription(testPhone);
      
      expect(result).toBe(false);
    });

    it('should handle invalid API key error', async () => {
      const authError = new Error('Invalid API key');
      (authError as any).statusCode = 401;
      
      mockStripe.customers.search.mockRejectedValue(authError);

      const result = await subscriptionService.checkSubscription(testPhone);
      
      expect(result).toBe(false);
    });
  });

  describe('getPaymentLink()', () => {
    it('should return static payment link', async () => {
      const link = await subscriptionService.getPaymentLink(testPhone);
      
      expect(link).toBe('https://checkout.stripe.com/test-session-url');
    });

    it('should return same link for different phone numbers', async () => {
      const link1 = await subscriptionService.getPaymentLink(testPhone);
      const link2 = await subscriptionService.getPaymentLink('9876543210');
      
      // BUG?: Static link for all users - might want dynamic links per user
      expect(link1).toBe(link2);
    });

    it('should return valid HTTPS URL', async () => {
      const link = await subscriptionService.getPaymentLink(testPhone);
      
      expect(link).toMatch(/^https:\/\//);
    });

    it('should not depend on Stripe being initialized', async () => {
      (subscriptionService as any).stripe = null;
      
      // Should still return link even if Stripe not initialized
      const link = await subscriptionService.getPaymentLink(testPhone);
      expect(link).toBeDefined();
    });
  });

  describe('Edge cases and production concerns', () => {
    it('should handle concurrent checkSubscription calls for same user', async () => {
      const mockCustomer = {
        id: 'cus_123',
        phone: testPhoneWithPlus,
      };

      mockStripe.customers.search.mockResolvedValue({
        data: [mockCustomer],
      } as any);

      mockStripe.subscriptions.list.mockResolvedValue({
        data: [{ id: 'sub_123', status: 'active' }],
      } as any);

      // Race condition: multiple checks at once
      const results = await Promise.all([
        subscriptionService.checkSubscription(testPhone),
        subscriptionService.checkSubscription(testPhone),
        subscriptionService.checkSubscription(testPhone),
      ]);

      expect(results).toEqual([true, true, true]);
      // Should have called Stripe 3 times (no caching)
      expect(mockStripe.customers.search).toHaveBeenCalledTimes(3);
    });

    it('should correctly handle disabled Stripe in production-like scenario', async () => {
      // In a production scenario with no API key, Stripe initialization will fail.
      // checkSubscription should then correctly return false.
      const service = SubscriptionService.getInstance();
      service.initialize(''); // Failed initialization
      
      const result = await service.checkSubscription(testPhone);
      
      expect(result).toBe(false);
    });

    it('should handle empty phone number', async () => {
      mockStripe.customers.search.mockResolvedValue({
        data: [],
      } as any);

      const result = await subscriptionService.checkSubscription('');
      
      expect(mockStripe.customers.search).toHaveBeenCalledWith({
        limit: 1,
        query: "phone:''",
      });
      expect(result).toBe(false);
    });

    it('should handle special characters in phone number', async () => {
      const phoneWithSpecialChars = '123-456-7890';
      
      mockStripe.customers.search.mockResolvedValue({
        data: [],
      } as any);

      await subscriptionService.checkSubscription(phoneWithSpecialChars);
      
      // BUG POTENTIAL: No sanitization of phone number
      expect(mockStripe.customers.search).toHaveBeenCalledWith({
        limit: 1,
        query: `phone:'+1234567890'`,
      });
    });

    it('should handle Stripe returning empty subscriptions array vs null', async () => {
      const mockCustomer = {
        id: 'cus_123',
        phone: testPhoneWithPlus,
      };

      mockStripe.customers.search.mockResolvedValue({
        data: [mockCustomer],
      } as any);

      // Empty array
      mockStripe.subscriptions.list.mockResolvedValue({
        data: [],
      } as any);

      const result1 = await subscriptionService.checkSubscription(testPhone);
      expect(result1).toBe(false);

      // Null/undefined data
      mockStripe.subscriptions.list.mockResolvedValue({
        data: null as any,
      } as any);

      const result2 = await subscriptionService.checkSubscription(testPhone);
      // BUG POTENTIAL: Might throw if not handling null properly
      expect(result2).toBe(false);
    });
  });

  describe('Webhook handling', () => {
    it('should update subscriber isPremium status on customer.subscription.updated webhook', async () => {
      // Arrange
      const subscriberPhone = '+1234567890';
      const customerId = 'cus_test_123';
      const rawBody = Buffer.from('{}'); // Raw body for signature verification
      const signature = 't=123,v1=abc'; // Mock signature

      // Create a subscriber who is not premium initially
      await subscriberService.createSubscriber(subscriberPhone, { isPremium: false });
      let subscriber = await subscriberService.getSubscriber(subscriberPhone);
      expect(subscriber?.isPremium).toBe(false);

      // Mock Stripe event for subscription update
      const mockStripeEvent: Stripe.Event = {
        id: 'evt_test_1',
        object: 'event',
        api_version: '2020-08-27',
        created: 1234567890,
        data: {
          object: {
            id: 'sub_test_1',
            object: 'subscription',
            status: 'active', // Subscription becomes active
            customer: {
              id: customerId,
              object: 'customer',
              phone: subscriberPhone, // Phone number to link to our subscriber
            } as Stripe.Customer,
            // ... other subscription properties
          } as Stripe.Subscription,
        },
        livemode: false,
        pending_webhooks: 1,
        request: {
          id: 'req_test_1',
          idempotency_key: 'key_test_1',
        },
        type: 'customer.subscription.updated',
      };

      // Mock constructEvent to return our mock event
      mockStripe.webhooks.constructEvent.mockReturnValue(mockStripeEvent);
      
      mockStripe.customers.retrieve.mockResolvedValue({
        id: customerId,
        phone: subscriberPhone,
      } as any);

      // Act
      await stripeWebhookService.handleWebhookEvent(signature, rawBody);

      // Assert
      subscriber = await subscriberService.getSubscriber(subscriberPhone);
      expect(subscriber?.isPremium).toBe(true); // Expect premium status to be updated
      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        rawBody,
        signature,
        testWebhookSecret
      );
    });

    it('should update subscriber isPremium status to false on customer.subscription.deleted webhook', async () => {
      // Arrange
      const subscriberPhone = '+1234567890_deleted';
      const customerId = 'cus_test_deleted';
      const rawBody = Buffer.from('{}');
      const signature = 't=123,v1=abc';

      // Create a subscriber who is premium initially
      await subscriberService.createSubscriber(subscriberPhone, { isPremium: true });
      let subscriber = await subscriberService.getSubscriber(subscriberPhone);
      expect(subscriber?.isPremium).toBe(true);

      // Mock Stripe event for subscription deletion
      const mockStripeEvent: Stripe.Event = {
        id: 'evt_test_2',
        object: 'event',
        api_version: '2020-08-27',
        created: 1234567890,
        data: {
          object: {
            id: 'sub_test_2',
            object: 'subscription',
            status: 'canceled', // Subscription becomes canceled
            customer: {
              id: customerId,
              object: 'customer',
              phone: subscriberPhone,
            } as Stripe.Customer,
          } as Stripe.Subscription,
        },
        livemode: false,
        pending_webhooks: 1,
        request: {
          id: 'req_test_2',
          idempotency_key: 'key_test_2',
        },
        type: 'customer.subscription.deleted',
      };

      mockStripe.webhooks.constructEvent.mockReturnValue(mockStripeEvent);

      mockStripe.customers.retrieve.mockResolvedValue({
        id: customerId,
        phone: subscriberPhone,
      } as any);

      // Act
      await stripeWebhookService.handleWebhookEvent(signature, rawBody);

      // Assert
      subscriber = await subscriberService.getSubscriber(subscriberPhone);
      expect(subscriber?.isPremium).toBe(false); // Expect premium status to be updated to false
      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        rawBody,
        signature,
        testWebhookSecret
      );
    });

    it('should throw error if webhook signature verification fails', async () => {
      // Arrange
      const rawBody = Buffer.from('{}');
      const invalidSignature = 't=123,v1=invalid';

      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature for payload');
      });

      // Act & Assert
      await expect(stripeWebhookService.handleWebhookEvent(invalidSignature, rawBody)).rejects.toThrow(
        'No signatures found matching the expected signature for payload'
      );
    });
  });
});
