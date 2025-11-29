import Stripe from "stripe";
import { Subscriber } from "../features/subscriber/subscriber.types";
import { logger } from "../../config";

export class SubscriptionService {
  private static instance: SubscriptionService;
  private stripe: Stripe | null = null;

  private constructor() {}

  static getInstance(): SubscriptionService {
    if (!SubscriptionService.instance) {
      SubscriptionService.instance = new SubscriptionService();
    }
    return StripeService.instance;
  }

  initialize(apiKey: string): void {
    if (!apiKey) {
      logger.error(
        "STRIPE_SECRET_KEY is not set. Stripe integration will be disabled.",
      );
      this.stripe = null;
      return;
    }
    this.stripe = new Stripe(apiKey);
  }

  async checkSubscription(phoneNumber: string): Promise<boolean> {
    if (!this.stripe) {
      logger.warn(
        "Stripe is not initialized. Subscription check is disabled. Returning false",
      );
      return false;
    }

    try {
      // Normalize the phone number to ensure it has exactly one leading '+'
      // Remove all leading '+' and then add a single '+'
      const normalizedPhoneNumber = '+' + phoneNumber.replace(/^\++/, '');

      const customers = await this.stripe.customers.search({
        limit: 1,
        query: `phone:'${normalizedPhoneNumber}'`,
      });

      if (customers.data.length === 0) {
        logger.info(
          { phoneNumber },
          "No Stripe customer found for this phone number.",
        );
        return false;
      }

      const customer = customers.data[0];
      logger.info(
        { customerId: customer.id, phoneNumber },
        "Found Stripe customer.",
      );

      const subscriptions = await this.stripe.subscriptions.list({
        customer: customer.id,
        status: "active",
        limit: 1,
      });

      if (subscriptions.data.length > 0) {
        logger.info(
          { customerId: customer.id, subscriptionId: subscriptions.data[0].id },
          "Active subscription found.",
        );
        return true;
      } else {
        logger.info(
          { customerId: customer.id },
          "No active subscription found for customer.",
        );
        return false;
      }
    } catch (error) {
      logger.error(
        { err: error, phoneNumber },
        "Error checking Stripe subscription.",
      );
      return false;
    }
  }

  constructEventFromWebhook(
    payload: Buffer,
    signature: string | string[],
    secret: string
  ): Stripe.Event {
    if (!this.stripe) {
      throw new Error("Stripe is not initialized. Cannot construct webhook event.");
    }
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }

  /**
   * Returns the Stripe payment link for subscription.
   * This can be static or generated per user if needed.
   */
  async getPaymentLink(phoneNumber: string): Promise<string> {
    // For now, return a static payment link. Replace with dynamic logic if needed.
    return "https://buy.stripe.com/dRmbJ3bYyfeM1pLgPX8AE01";
  }
}
