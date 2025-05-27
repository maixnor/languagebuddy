\
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
  stripe = new Stripe(apiKey, { apiVersion: '2024-04-10' });
  logger = pinoLogger;
  logger.info("Stripe initialized.");
}

export async function checkStripeSubscription(phoneNumber: string): Promise<boolean> {
  if (!stripe) {
    logger.warn("Stripe is not initialized. Assuming user has paid (development/testing mode).");
    return true; // Or false, depending on desired default behavior without Stripe
  }
  try {
    const customers = await stripe.customers.list({
      limit: 1,
      // email: `user-${phoneNumber}@example.com`, // If you create emails like this
      // metadata: { 'phone_number': phoneNumber } // This is usually how you'd do it.
    });

    if (customers.data.length === 0) {
      logger.info({ phoneNumber }, "No Stripe customer found for this phone number.");
      return false;
    }

    const customer = customers.data[0];
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
