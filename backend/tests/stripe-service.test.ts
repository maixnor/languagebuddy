import { StripeService } from '../src/services/stripe-service';
import Stripe from 'stripe';
import { logger } from '../src/config';

// Mock Stripe
jest.mock('stripe');
const MockedStripe = Stripe as jest.MockedClass<typeof Stripe>;

// Mock logger
jest.mock('../../config', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  }
}));

describe('StripeService', () => {
  let stripeService: StripeService;
  let mockStripeInstance: jest.Mocked<Stripe>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset singleton instance
    (StripeService as any).instance = undefined;
    
    // Create mock Stripe instance
    mockStripeInstance = {
      customers: {
        search: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      subscriptions: {
        list: jest.fn(),
      },
    } as any;

    MockedStripe.mockImplementation(() => mockStripeInstance);
    
    stripeService = StripeService.getInstance();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance when called multiple times', () => {
      const instance1 = StripeService.getInstance();
      const instance2 = StripeService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('initialize', () => {
    it('should initialize Stripe with valid API key', () => {
      const apiKey = 'sk_test_valid_key';
      
      stripeService.initialize(apiKey);
      
      expect(MockedStripe).toHaveBeenCalledWith(apiKey);
      expect(logger.info).toHaveBeenCalledWith('Stripe service initialized.');
    });

    it('should handle missing API key gracefully', () => {
      stripeService.initialize('');
      
      expect(MockedStripe).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'STRIPE_SECRET_KEY is not set. Stripe integration will be disabled.'
      );
    });

    it('should handle undefined API key gracefully', () => {
      stripeService.initialize(undefined as any);
      
      expect(MockedStripe).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'STRIPE_SECRET_KEY is not set. Stripe integration will be disabled.'
      );
    });
  });

  describe('checkSubscription', () => {
    const phoneNumber = '1234567890';

    beforeEach(() => {
      stripeService.initialize('sk_test_valid_key');
    });

    it('should return true when customer has active subscription', async () => {
      const mockCustomer = { id: 'cus_123', phone: '+1234567890' };
      const mockSubscription = { id: 'sub_123', status: 'active' };

      mockStripeInstance.customers.search.mockResolvedValue({
        data: [mockCustomer]
      } as any);

      mockStripeInstance.subscriptions.list.mockResolvedValue({
        data: [mockSubscription]
      } as any);

      const result = await stripeService.checkSubscription(phoneNumber);

      expect(result).toBe(true);
      expect(mockStripeInstance.customers.search).toHaveBeenCalledWith({
        limit: 1,
        query: `phone:'+${phoneNumber}'`
      });
      expect(mockStripeInstance.subscriptions.list).toHaveBeenCalledWith({
        customer: mockCustomer.id,
        status: 'active',
        limit: 1,
      });
    });

    it('should return false when customer has no active subscription', async () => {
      const mockCustomer = { id: 'cus_123', phone: '+1234567890' };

      mockStripeInstance.customers.search.mockResolvedValue({
        data: [mockCustomer]
      } as any);

      mockStripeInstance.subscriptions.list.mockResolvedValue({
        data: []
      } as any);

      const result = await stripeService.checkSubscription(phoneNumber);

      expect(result).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(
        { customerId: mockCustomer.id },
        'No active subscription found for customer.'
      );
    });

    it('should return false when customer is not found', async () => {
      mockStripeInstance.customers.search.mockResolvedValue({
        data: []
      } as any);

      const result = await stripeService.checkSubscription(phoneNumber);

      expect(result).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(
        { phoneNumber },
        'No Stripe customer found for this phone number.'
      );
    });

    it('should return true in development mode when Stripe is not initialized', async () => {
      // Create service without initialization
      const uninitializedService = StripeService.getInstance();
      
      const result = await uninitializedService.checkSubscription(phoneNumber);

      expect(result).toBe(true);
      expect(logger.trace).toHaveBeenCalledWith(
        'Stripe is not initialized. Assuming user has paid (development/testing mode).'
      );
    });

    it('should handle Stripe API errors gracefully', async () => {
      const error = new Error('Stripe API Error');
      mockStripeInstance.customers.search.mockRejectedValue(error);

      const result = await stripeService.checkSubscription(phoneNumber);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        { err: error, phoneNumber },
        'Error checking Stripe subscription.'
      );
    });
  });

  describe('updateCustomerMetadata', () => {
    const phoneNumber = '1234567890';
    const metadata = {
      name: 'Test User',
      learningLanguages: [{ languageName: 'Spanish', level: 'B1' }],
      speakingLanguages: [{ languageName: 'English', level: 'C2' }],
      messageHistory: ['some', 'messages'],
      phone: phoneNumber
    };

    beforeEach(() => {
      stripeService.initialize('sk_test_valid_key');
    });

    it('should update customer metadata successfully', async () => {
      const mockCustomer = { id: 'cus_123', phone: '+1234567890' };

      mockStripeInstance.customers.search.mockResolvedValue({
        data: [mockCustomer]
      } as any);

      mockStripeInstance.customers.update.mockResolvedValue({} as any);

      const result = await stripeService.updateCustomerMetadata(phoneNumber, metadata);

      expect(result).toBe(true);
      expect(mockStripeInstance.customers.update).toHaveBeenCalledWith(
        mockCustomer.id,
        {
          metadata: {
            name: 'Test User',
            learningLanguages: JSON.stringify([{ languageName: 'Spanish', level: 'B1' }]),
            speakingLanguages: JSON.stringify([{ languageName: 'English', level: 'C2' }]),
            // messageHistory and phone should be filtered out
          }
        }
      );
    });

    it('should return false when customer is not found', async () => {
      mockStripeInstance.customers.search.mockResolvedValue({
        data: []
      } as any);

      const result = await stripeService.updateCustomerMetadata(phoneNumber, metadata);

      expect(result).toBe(false);
      expect(logger.trace).toHaveBeenCalledWith(
        { phoneNumber },
        'No Stripe customer found for this phone number.'
      );
    });

    it('should return false when Stripe is not initialized', async () => {
      const uninitializedService = StripeService.getInstance();
      
      const result = await uninitializedService.updateCustomerMetadata(phoneNumber, metadata);

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'Stripe is not initialized. Cannot update customer metadata.'
      );
    });

    it('should handle Stripe API errors gracefully', async () => {
      const error = new Error('Stripe API Error');
      mockStripeInstance.customers.search.mockRejectedValue(error);

      const result = await stripeService.updateCustomerMetadata(phoneNumber, metadata);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        { err: error, phoneNumber },
        'Error updating customer metadata.'
      );
    });

    it('should properly serialize complex objects in metadata', async () => {
      const mockCustomer = { id: 'cus_123', phone: '+1234567890' };
      const complexMetadata = {
        learningLanguages: [{ languageName: 'French', level: 'A2', goals: ['travel', 'work'] }],
        speakingLanguages: [{ languageName: 'German', level: 'B2', certified: true }]
      };

      mockStripeInstance.customers.search.mockResolvedValue({
        data: [mockCustomer]
      } as any);

      mockStripeInstance.customers.update.mockResolvedValue({} as any);

      await stripeService.updateCustomerMetadata(phoneNumber, complexMetadata);

      const expectedCall = mockStripeInstance.customers.update.mock.calls[0];
      const actualMetadata = expectedCall[1].metadata;

      expect(actualMetadata.learningLanguages).toBe(JSON.stringify(complexMetadata.learningLanguages));
      expect(actualMetadata.speakingLanguages).toBe(JSON.stringify(complexMetadata.speakingLanguages));
    });
  });

  describe('getCustomerMetadata', () => {
    const phoneNumber = '1234567890';

    beforeEach(() => {
      stripeService.initialize('sk_test_valid_key');
    });

    it('should retrieve and parse customer metadata successfully', async () => {
      const mockCustomer = {
        id: 'cus_123',
        phone: '+1234567890',
        metadata: {
          name: 'Test User',
          learningLanguages: JSON.stringify([{ languageName: 'Spanish', level: 'B1' }]),
          speakingLanguages: JSON.stringify([{ languageName: 'English', level: 'C2' }])
        }
      };

      mockStripeInstance.customers.search.mockResolvedValue({
        data: [mockCustomer]
      } as any);

      const result = await stripeService.getCustomerMetadata(phoneNumber);

      expect(result).toEqual({
        phone: phoneNumber,
        name: 'Test User',
        learningLanguages: [{ languageName: 'Spanish', level: 'B1' }],
        speakingLanguages: [{ languageName: 'English', level: 'C2' }]
      });
    });

    it('should handle missing metadata fields gracefully', async () => {
      const mockCustomer = {
        id: 'cus_123',
        phone: '+1234567890',
        metadata: {
          name: 'Test User'
          // No language fields
        }
      };

      mockStripeInstance.customers.search.mockResolvedValue({
        data: [mockCustomer]
      } as any);

      const result = await stripeService.getCustomerMetadata(phoneNumber);

      expect(result).toEqual({
        phone: phoneNumber,
        name: 'Test User',
        learningLanguages: [],
        speakingLanguages: []
      });
    });

    it('should handle invalid JSON in metadata gracefully', async () => {
      const mockCustomer = {
        id: 'cus_123',
        phone: '+1234567890',
        metadata: {
          name: 'Test User',
          learningLanguages: 'invalid json {',
          speakingLanguages: 'also invalid ['
        }
      };

      mockStripeInstance.customers.search.mockResolvedValue({
        data: [mockCustomer]
      } as any);

      const result = await stripeService.getCustomerMetadata(phoneNumber);

      expect(result).toEqual({
        phone: phoneNumber,
        name: 'Test User',
        learningLanguages: [],
        speakingLanguages: []
      });

      expect(logger.error).toHaveBeenCalledTimes(2); // Once for each parse error
    });

    it('should return null when customer is not found', async () => {
      mockStripeInstance.customers.search.mockResolvedValue({
        data: []
      } as any);

      const result = await stripeService.getCustomerMetadata(phoneNumber);

      expect(result).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        { phoneNumber },
        'No Stripe customer found for this phone number. No metadata to retrieve.'
      );
    });

    it('should return null when Stripe is not initialized', async () => {
      const uninitializedService = StripeService.getInstance();
      
      const result = await uninitializedService.getCustomerMetadata(phoneNumber);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Stripe is not initialized. Cannot retrieve customer metadata.'
      );
    });
  });

  describe('createCustomer', () => {
    const phoneNumber = '1234567890';
    const email = 'test@example.com';
    const name = 'Test User';

    beforeEach(() => {
      stripeService.initialize('sk_test_valid_key');
    });

    it('should create customer successfully', async () => {
      const mockCustomer = { id: 'cus_123' };
      mockStripeInstance.customers.create.mockResolvedValue(mockCustomer as any);

      const result = await stripeService.createCustomer(phoneNumber, email, name);

      expect(result).toBe('cus_123');
      expect(mockStripeInstance.customers.create).toHaveBeenCalledWith({
        phone: `+${phoneNumber}`,
        email,
        name,
        metadata: {
          phone: phoneNumber,
          createdAt: expect.any(String)
        }
      });
    });

    it('should create customer with minimal data', async () => {
      const mockCustomer = { id: 'cus_123' };
      mockStripeInstance.customers.create.mockResolvedValue(mockCustomer as any);

      const result = await stripeService.createCustomer(phoneNumber);

      expect(result).toBe('cus_123');
      expect(mockStripeInstance.customers.create).toHaveBeenCalledWith({
        phone: `+${phoneNumber}`,
        email: undefined,
        name: undefined,
        metadata: {
          phone: phoneNumber,
          createdAt: expect.any(String)
        }
      });
    });

    it('should return null when Stripe is not initialized', async () => {
      const uninitializedService = StripeService.getInstance();
      
      const result = await uninitializedService.createCustomer(phoneNumber, email, name);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Stripe is not initialized. Cannot create customer.'
      );
    });

    it('should handle Stripe API errors gracefully', async () => {
      const error = new Error('Stripe API Error');
      mockStripeInstance.customers.create.mockRejectedValue(error);

      const result = await stripeService.createCustomer(phoneNumber, email, name);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        { err: error, phoneNumber },
        'Error creating Stripe customer.'
      );
    });
  });

  describe('getCustomerSubscriptions', () => {
    const phoneNumber = '1234567890';

    beforeEach(() => {
      stripeService.initialize('sk_test_valid_key');
    });

    it('should retrieve customer subscriptions successfully', async () => {
      const mockCustomer = { id: 'cus_123' };
      const mockSubscriptions = [
        { id: 'sub_123', status: 'active' },
        { id: 'sub_456', status: 'canceled' }
      ];

      mockStripeInstance.customers.search.mockResolvedValue({
        data: [mockCustomer]
      } as any);

      mockStripeInstance.subscriptions.list.mockResolvedValue({
        data: mockSubscriptions
      } as any);

      const result = await stripeService.getCustomerSubscriptions(phoneNumber);

      expect(result).toEqual(mockSubscriptions);
      expect(mockStripeInstance.subscriptions.list).toHaveBeenCalledWith({
        customer: mockCustomer.id,
        limit: 10,
      });
    });

    it('should return empty array when customer is not found', async () => {
      mockStripeInstance.customers.search.mockResolvedValue({
        data: []
      } as any);

      const result = await stripeService.getCustomerSubscriptions(phoneNumber);

      expect(result).toEqual([]);
    });

    it('should return empty array when Stripe is not initialized', async () => {
      const uninitializedService = StripeService.getInstance();
      
      const result = await uninitializedService.getCustomerSubscriptions(phoneNumber);

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        'Stripe is not initialized. Cannot retrieve subscriptions.'
      );
    });

    it('should handle Stripe API errors gracefully', async () => {
      const error = new Error('Stripe API Error');
      mockStripeInstance.customers.search.mockRejectedValue(error);

      const result = await stripeService.getCustomerSubscriptions(phoneNumber);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        { err: error, phoneNumber },
        'Error retrieving customer subscriptions.'
      );
    });
  });

  describe('Edge Cases and Integration', () => {
    it('should handle concurrent initialization calls', () => {
      const service1 = StripeService.getInstance();
      const service2 = StripeService.getInstance();
      
      service1.initialize('key1');
      service2.initialize('key2');

      // Should only be called once due to singleton pattern
      expect(MockedStripe).toHaveBeenCalledTimes(1);
      expect(MockedStripe).toHaveBeenCalledWith('key1');
    });

    it('should handle phone number formatting consistently', async () => {
      stripeService.initialize('sk_test_valid_key');
      const phoneNumber = '1234567890';
      
      mockStripeInstance.customers.search.mockResolvedValue({ data: [] } as any);

      await stripeService.checkSubscription(phoneNumber);
      await stripeService.updateCustomerMetadata(phoneNumber, {});
      await stripeService.getCustomerMetadata(phoneNumber);

      // All calls should format phone number consistently
      const searchCalls = mockStripeInstance.customers.search.mock.calls;
      searchCalls.forEach(call => {
        expect(call[0].query).toBe(`phone:'+${phoneNumber}'`);
      });
    });
  });
});