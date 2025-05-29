
import Stripe from 'stripe';
import pino from 'pino';

let stripe: Stripe | null = null;
let logger: pino.Logger;

export function initStripe(apiKey: string, pinoLogger: pino.Logger) {
  if (!apiKey) {
    pinoLogger.warn("STRIPE_SECRET_KEY is not set. Stripe integration will be disabled.");
    stripe = null;
    return;
  }
  stripe = new Stripe(apiKey);
  logger = pinoLogger;
  logger.info("Stripe initialized.");
}

export async function checkStripeSubscription(phoneNumber: string): Promise<boolean> {
  if (!stripe) {
    logger.warn("Stripe is not initialized. Assuming user has paid (development/testing mode).");
    return true; // TODO
  }
  try {
    const customers = await stripe.customers.search({
      limit: 1,
      query: `phone:'${phoneNumber}'`
    });

    if (customers.data.length === 0) {
      logger.info({ phoneNumber }, "No Stripe customer found for this phone number.");
      return false;
    }

    const customer = customers.data[0];
    logger.info(customer);
    logger.info({ customerId: customer.id, phoneNumber }, "Found Stripe customer.");

    const subscriptions = await stripe.subscriptions.list({
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
