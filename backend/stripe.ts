import Stripe from 'stripe';
import pino from 'pino';
import { Subscriber } from './types';

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
    logger.trace("Stripe is not initialized. Assuming user has paid (development/testing mode).");
    return true; // TODO
  }
  try {
    const customers = await stripe.customers.search({
      limit: 1,
      query: `phone:'+${phoneNumber}'` // Whatsapp phone numbers are without the plus. adding it here
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

export async function updateCustomerMetadata(phoneNumber: string, metadata: Stripe.MetadataParam): Promise<boolean> {
  if (!stripe) {
    logger.warn("Stripe is not initialized. Cannot update customer metadata.");
    return false;
  }
  try {
    const customers = await stripe.customers.search({
      limit: 1,
      query: `phone:'+${phoneNumber}'`
    });

    if (customers.data.length === 0) {
      logger.trace({ phoneNumber }, "No Stripe customer found for this phone number.");
      return false;
    }

    const customer = customers.data[0];
    logger.info({ customerId: customer.id, phoneNumber }, "Found Stripe customer. Updating metadata.");

    // Prepare metadata for Stripe by stringifying complex objects
    const processedMetadata: Stripe.MetadataParam = { ...metadata };
    if (processedMetadata.learningLanguages && typeof processedMetadata.learningLanguages !== 'string') {
      processedMetadata.learningLanguages = JSON.stringify(processedMetadata.learningLanguages);
    }
    if (processedMetadata.speakingLanguages && typeof processedMetadata.speakingLanguages !== 'string') {
      processedMetadata.speakingLanguages = JSON.stringify(processedMetadata.speakingLanguages);
    }
    delete processedMetadata.messageHistory;
    delete processedMetadata.phone;

    await stripe.customers.update(customer.id, {
      metadata: processedMetadata,
    });
    logger.info({ customerId: customer.id }, "Customer metadata updated.");
    return true;
  } catch (error) {
    logger.error({ err: error, phoneNumber }, "Error updating customer metadata.");
    return false;
  }
}

export async function getCustomerMetadata(phoneNumber: string): Promise<Partial<Subscriber> | null> {
  if (!stripe) {
    logger.warn("Stripe is not initialized. Cannot retrieve customer metadata.");
    return null;
  }
  try {
    const customers = await stripe.customers.search({
      limit: 1,
      query: `phone:'+${phoneNumber}'`
    });

    if (customers.data.length === 0) {
      logger.info({ phoneNumber }, "No Stripe customer found for this phone number. No metadata to retrieve.");
      return null;
    }

    const customer = customers.data[0];
    const metadata = customer.metadata;
    logger.info({ customerId: customer.id, phoneNumber }, "Found Stripe customer. Retrieving metadata.");

    const subscriberData: Partial<Subscriber> = {
      phone: phoneNumber, // Assuming phone number used for lookup is the subscriber's phone
      name: metadata.name || undefined,
    };

    if (metadata.learningLanguages && typeof metadata.learningLanguages === 'string') {
      try {
        subscriberData.learningLanguages = JSON.parse(metadata.learningLanguages);
      } catch (e) {
        logger.error({ err: e, customerId: customer.id, phoneNumber }, "Error parsing learningLanguages from metadata.");
        subscriberData.learningLanguages = [];
      }
    } else {
      subscriberData.learningLanguages = [];
    }

    if (metadata.speakingLanguages && typeof metadata.speakingLanguages === 'string') {
      try {
        subscriberData.speakingLanguages = JSON.parse(metadata.speakingLanguages);
      } catch (e) {
        logger.error({ err: e, customerId: customer.id, phoneNumber }, "Error parsing speakingLanguages from metadata.");
        subscriberData.speakingLanguages = [];
      }
    } else {
      subscriberData.speakingLanguages = [];
    }
    
    return subscriberData;
  } catch (error) {
    logger.error({ err: error, phoneNumber }, "Error retrieving customer metadata.");
    return null;
  }
}
