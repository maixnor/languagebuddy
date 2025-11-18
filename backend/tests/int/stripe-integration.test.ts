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

import { StripeService } from '../../src/services/stripe-service';
import Stripe from 'stripe';

// Mock Stripe
jest.mock('stripe');

describe('StripeService - Integration Tests', () => {
  let stripeService: StripeService;
  let mockStripe: jest.Mocked<Stripe>;
  const testPhone = '1234567890';
  const testPhoneWithPlus = '+1234567890';

  beforeEach(() => {
    // Reset singleton
    (StripeService as any).instance = null;
    stripeService = StripeService.getInstance();

    // Create mock Stripe instance
    mockStripe = {
      customers: {
        search: jest.fn(),
      } as any,
      subscriptions: {
        list: jest.fn(),
      } as any,
    } as any;

    // Initialize with mock
    (stripeService as any).stripe = mockStripe;
  });

  describe('initialize()', () => {
    it('should set stripe to null if no API key provided', () => {
      const service = StripeService.getInstance();
      service.initialize('');
      
      expect((service as any).stripe).toBeNull();
    });

    it('should initialize Stripe with valid API key', () => {
      const service = StripeService.getInstance();
      service.initialize('sk_test_12345');
      
      // Stripe should be initialized (mocked in real tests)
      expect((service as any).stripe).toBeDefined();
    });
  });

  describe('checkSubscription()', () => {
    it('should return true if Stripe is not initialized (dev mode)', async () => {
      (stripeService as any).stripe = null;
      
      const result = await stripeService.checkSubscription(testPhone);
      
      // BUG: This returns true in dev mode - dangerous for production!
      expect(result).toBe(true);
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

      const result = await stripeService.checkSubscription(testPhone);
      
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

      const result = await stripeService.checkSubscription(testPhone);
      
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

      const result = await stripeService.checkSubscription(testPhone);
      
      expect(result).toBe(false);
    });

    it('should handle Stripe API errors gracefully', async () => {
      mockStripe.customers.search.mockRejectedValue(new Error('Stripe API error'));

      const result = await stripeService.checkSubscription(testPhone);
      
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

      const result = await stripeService.checkSubscription(testPhone);
      
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

      const result = await stripeService.checkSubscription(testPhone);
      
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

      const result = await stripeService.checkSubscription(testPhone);
      
      expect(result).toBe(false);
    });

    it('should add plus sign to phone number in query', async () => {
      // BUG POTENTIAL: Comment says "WhatsApp phone numbers are without the plus"
      // but what if they already have it?
      
      mockStripe.customers.search.mockResolvedValue({
        data: [],
      } as any);

      await stripeService.checkSubscription(testPhone);
      
      expect(mockStripe.customers.search).toHaveBeenCalledWith({
        limit: 1,
        query: `phone:'+${testPhone}'`,
      });
    });

    it('should handle phone number already with plus sign', async () => {
      // BUG POTENTIAL: Double plus sign if phone already has it
      mockStripe.customers.search.mockResolvedValue({
        data: [],
      } as any);

      await stripeService.checkSubscription(testPhoneWithPlus);
      
      const call = mockStripe.customers.search.mock.calls[0][0];
      // Should have double plus: +'+1234567890'
      expect(call.query).toBe(`phone:'++1234567890'`);
    });

    it('should handle Stripe returning null/undefined customer', async () => {
      mockStripe.customers.search.mockResolvedValue({
        data: [null as any],
      } as any);

      // Should not throw
      const result = await stripeService.checkSubscription(testPhone);
      expect(result).toBe(false);
    });

    it('should handle Stripe returning malformed response', async () => {
      mockStripe.customers.search.mockResolvedValue({
        data: undefined as any,
      } as any);

      // Should not throw
      const result = await stripeService.checkSubscription(testPhone);
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

      const result = await stripeService.checkSubscription(testPhone);
      
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

      const result = await stripeService.checkSubscription(testPhone);
      
      expect(result).toBe(false);
    });

    it('should handle Stripe rate limiting', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).statusCode = 429;
      
      mockStripe.customers.search.mockRejectedValue(rateLimitError);

      const result = await stripeService.checkSubscription(testPhone);
      
      expect(result).toBe(false);
    });

    it('should handle invalid API key error', async () => {
      const authError = new Error('Invalid API key');
      (authError as any).statusCode = 401;
      
      mockStripe.customers.search.mockRejectedValue(authError);

      const result = await stripeService.checkSubscription(testPhone);
      
      expect(result).toBe(false);
    });
  });

  describe('getPaymentLink()', () => {
    it('should return static payment link', async () => {
      const link = await stripeService.getPaymentLink(testPhone);
      
      expect(link).toBe('https://buy.stripe.com/dRmbJ3bYyfeM1pLgPX8AE01');
    });

    it('should return same link for different phone numbers', async () => {
      const link1 = await stripeService.getPaymentLink(testPhone);
      const link2 = await stripeService.getPaymentLink('9876543210');
      
      // BUG?: Static link for all users - might want dynamic links per user
      expect(link1).toBe(link2);
    });

    it('should return valid HTTPS URL', async () => {
      const link = await stripeService.getPaymentLink(testPhone);
      
      expect(link).toMatch(/^https:\/\//);
    });

    it('should not depend on Stripe being initialized', async () => {
      (stripeService as any).stripe = null;
      
      // Should still return link even if Stripe not initialized
      const link = await stripeService.getPaymentLink(testPhone);
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
        stripeService.checkSubscription(testPhone),
        stripeService.checkSubscription(testPhone),
        stripeService.checkSubscription(testPhone),
      ]);

      expect(results).toEqual([true, true, true]);
      // Should have called Stripe 3 times (no caching)
      expect(mockStripe.customers.search).toHaveBeenCalledTimes(3);
    });

    it('should detect production mode issue (returns true when Stripe disabled)', async () => {
      // BUG: In production, if Stripe fails to initialize, all users get premium!
      const service = StripeService.getInstance();
      service.initialize(''); // Failed initialization
      
      const result = await service.checkSubscription(testPhone);
      
      // This is DANGEROUS in production
      expect(result).toBe(true);
    });

    it('should handle empty phone number', async () => {
      mockStripe.customers.search.mockResolvedValue({
        data: [],
      } as any);

      const result = await stripeService.checkSubscription('');
      
      expect(mockStripe.customers.search).toHaveBeenCalledWith({
        limit: 1,
        query: "phone:'+'",
      });
      expect(result).toBe(false);
    });

    it('should handle special characters in phone number', async () => {
      const phoneWithSpecialChars = '123-456-7890';
      
      mockStripe.customers.search.mockResolvedValue({
        data: [],
      } as any);

      await stripeService.checkSubscription(phoneWithSpecialChars);
      
      // BUG POTENTIAL: No sanitization of phone number
      expect(mockStripe.customers.search).toHaveBeenCalledWith({
        limit: 1,
        query: `phone:'+123-456-7890'`,
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

      const result1 = await stripeService.checkSubscription(testPhone);
      expect(result1).toBe(false);

      // Null/undefined data
      mockStripe.subscriptions.list.mockResolvedValue({
        data: null as any,
      } as any);

      const result2 = await stripeService.checkSubscription(testPhone);
      // BUG POTENTIAL: Might throw if not handling null properly
      expect(result2).toBe(false);
    });
  });

  describe('Webhook handling (not implemented)', () => {
    it('should note that webhook handling is missing', () => {
      // BUG: No webhook handlers for:
      // - customer.subscription.created
      // - customer.subscription.updated
      // - customer.subscription.deleted
      // - invoice.payment_failed
      // This means isPremium flag won't auto-update on subscription changes!
      
      expect(true).toBe(true); // Placeholder test to document missing feature
    });
  });
});
