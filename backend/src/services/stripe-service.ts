import Stripe from 'stripe';
import { Subscriber } from '../types';
import { logger } from '../config';

export class StripeService {
  private static instance: StripeService;
  private stripe: Stripe | null = null;

  private constructor() {}

  static getInstance(): StripeService {
    if (!StripeService.instance) {
      StripeService.instance = new StripeService();
    }
    return StripeService.instance;
  }

  initialize(apiKey: string): void {
    if (!apiKey) {
      logger.warn("STRIPE_SECRET_KEY is not set. Stripe integration will be disabled.");
      this.stripe = null;
      return;
    }
    this.stripe = new Stripe(apiKey);
    logger.info("Stripe service initialized.");
  }

  async checkSubscription(phoneNumber: string): Promise<boolean> {
    if (!this.stripe) {
      logger.trace("Stripe is not initialized. Assuming user has paid (development/testing mode).");
      return true; // TODO: Remove this in production
    }

    try {
      const customers = await this.stripe.customers.search({
        limit: 1,
        query: `phone:'+${phoneNumber}'` // WhatsApp phone numbers are without the plus, adding it here
      });

      if (customers.data.length === 0) {
        logger.info({ phoneNumber }, "No Stripe customer found for this phone number.");
        return false;
      }

      const customer = customers.data[0];
      logger.info({ customerId: customer.id, phoneNumber }, "Found Stripe customer.");

      const subscriptions = await this.stripe.subscriptions.list({
        customer: customer.id,
        status: 'active',
        limit: 1,
      });

      if (subscriptions.data.length > 0) {
        logger.info({ customerId: customer.id, subscriptionId: subscriptions.data[0].id }, "Active subscription found.");
        return true;
      } else {
        logger.info({ customerId: customer.id }, "No active subscription found for customer.");
        return false;
      }
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error checking Stripe subscription.");
      return false;
    }
  }
}