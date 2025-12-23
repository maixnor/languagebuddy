import { SubscriptionService } from './subscription.service';
import { StripeWebhookService } from './subscription-webhook.service';
import { SubscriberService } from '../subscriber/subscriber.service';
import { DatabaseService } from '../../core/database';
import { logger } from '../../core/config';
import Stripe from 'stripe';

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          url: 'https://test-stripe-url.com/checkout',
          id: 'sess_123',
        }),
      },
    },
    webhooks: {
      constructEvent: jest.fn((payload, sig, secret) => {
        return JSON.parse(payload.toString());
      }),
    },
    customers: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'cus_test123',
        phone: '+15550000000', // Should NOT be used for lookup if client_reference_id is present
      }),
      search: jest.fn().mockResolvedValue({ data: [] }),
    },
    subscriptions: {
      list: jest.fn().mockResolvedValue({ data: [] }),
    },
  }));
});

describe('Subscription Flow Integration', () => {
  let dbService: DatabaseService;
  let subscriberService: SubscriberService;
  let subscriptionService: SubscriptionService;
  let webhookService: StripeWebhookService;
  let stripeInstance: any;

  beforeAll(() => {
    dbService = new DatabaseService(':memory:');
    subscriberService = SubscriberService.getInstance(dbService);
    subscriptionService = SubscriptionService.getInstance();
    subscriptionService.initialize('sk_test_mock'); // Initialize to create stripe instance
    webhookService = new StripeWebhookService(subscriberService, subscriptionService, 'whsec_mock');
    
    // Access the mocked stripe instance from the service
    stripeInstance = (subscriptionService as any).stripe;
  });

  afterAll(() => {
    dbService.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset DB state if needed (in memory is fresh per run but tables persist, so delete data)
    dbService.getDb().exec('DELETE FROM subscribers');
  });

  it('should generate a correct checkout session with client_reference_id and trial logic', async () => {
    const phoneNumber = '+15551234567';
    await subscriberService.createSubscriber(phoneNumber);

    // Call the NEW method we expect to exist
    // @ts-ignore - method not created yet
    const sessionUrl = await subscriptionService.createCheckoutSession(phoneNumber);

    expect(sessionUrl).toBe('https://test-stripe-url.com/checkout');

    // Verify Stripe was called with correct parameters
    expect(stripeInstance.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      client_reference_id: phoneNumber,
      mode: 'subscription',
      subscription_data: expect.objectContaining({
        trial_period_days: 21
      }),
      // We expect a line item for the recurring price and potentially a setup fee or invoice item
      line_items: expect.arrayContaining([
         expect.objectContaining({
             price_data: expect.objectContaining({
                 currency: 'eur',
                 unit_amount: 1000, // 10 EUR
                 recurring: expect.objectContaining({ interval: 'month' })
             })
         })
      ]),
    }));
  });

  it('should update subscriber status based on webhook client_reference_id', async () => {
    const phoneNumber = '+15559876543';
    // Create subscriber (non-premium)
    await subscriberService.createSubscriber(phoneNumber);
    
    const event = {
      id: 'evt_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: phoneNumber,
          customer: 'cus_newStripeId',
          subscription: 'sub_123',
        }
      }
    };

    await webhookService.handleWebhookEvent('sig', Buffer.from(JSON.stringify(event)));

    const updatedSubscriber = await subscriberService.getSubscriber(phoneNumber);
    
    // Expectation: Subscriber is now premium and has stripeCustomerId
    expect(updatedSubscriber?.isPremium).toBe(true);
    // @ts-ignore - field not created yet
    expect(updatedSubscriber?.stripeCustomerId).toBe('cus_newStripeId');
  });

  it('should update subscriber based on stripeCustomerId in subsequent webhooks', async () => {
    const phoneNumber = '+15551112222';
    // Manually create subscriber with stripeCustomerId to simulate state after checkout
    await subscriberService.createSubscriber(phoneNumber, { 
        // @ts-ignore
        stripeCustomerId: 'cus_existing' 
    } as any);

    // Mock retrieveCustomer to return a DIFFERENT phone number or no phone, to prove we rely on ID
    stripeInstance.customers.retrieve.mockResolvedValueOnce({
        id: 'cus_existing',
        phone: null // No phone in Stripe
    });

    const event = {
      id: 'evt_456',
      type: 'customer.subscription.updated',
      data: {
        object: {
          customer: 'cus_existing',
          status: 'active'
        }
      }
    };

    await webhookService.handleWebhookEvent('sig', Buffer.from(JSON.stringify(event)));

    // Verify we found the subscriber and updated/kept them premium
    const sub = await subscriberService.getSubscriber(phoneNumber);
    expect(sub?.isPremium).toBe(true);
  });
});
