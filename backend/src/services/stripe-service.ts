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

  async updateCustomerMetadata(phoneNumber: string, metadata: Stripe.MetadataParam): Promise<boolean> {
    if (!this.stripe) {
      logger.warn("Stripe is not initialized. Cannot update customer metadata.");
      return false;
    }

    try {
      const customers = await this.stripe.customers.search({
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

      await this.stripe.customers.update(customer.id, {
        metadata: processedMetadata,
      });
      logger.info({ customerId: customer.id }, "Customer metadata updated.");
      return true;
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error updating customer metadata.");
      return false;
    }
  }

  async getCustomerMetadata(phoneNumber: string): Promise<Partial<Subscriber> | null> {
    if (!this.stripe) {
      logger.warn("Stripe is not initialized. Cannot retrieve customer metadata.");
      return null;
    }

    try {
      const customers = await this.stripe.customers.search({
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
        phone: phoneNumber,
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

  async createCustomer(phoneNumber: string, email?: string, name?: string): Promise<string | null> {
    if (!this.stripe) {
      logger.warn("Stripe is not initialized. Cannot create customer.");
      return null;
    }

    try {
      const customer = await this.stripe.customers.create({
        phone: `+${phoneNumber}`,
        email,
        name,
        metadata: {
          phone: phoneNumber,
          createdAt: new Date().toISOString()
        }
      });

      logger.info({ customerId: customer.id, phoneNumber }, "Stripe customer created.");
      return customer.id;
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error creating Stripe customer.");
      return null;
    }
  }

  async getCustomerSubscriptions(phoneNumber: string): Promise<Stripe.Subscription[]> {
    if (!this.stripe) {
      logger.warn("Stripe is not initialized. Cannot retrieve subscriptions.");
      return [];
    }

    try {
      const customers = await this.stripe.customers.search({
        limit: 1,
        query: `phone:'+${phoneNumber}'`
      });

      if (customers.data.length === 0) {
        return [];
      }

      const customer = customers.data[0];
      const subscriptions = await this.stripe.subscriptions.list({
        customer: customer.id,
        limit: 10,
      });

      return subscriptions.data;
    } catch (error) {
      logger.error({ err: error, phoneNumber }, "Error retrieving customer subscriptions.");
      return [];
    }
  }
}