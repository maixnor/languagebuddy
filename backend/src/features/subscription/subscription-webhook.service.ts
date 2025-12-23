import Stripe from 'stripe';
import { SubscriberService } from '../subscriber/subscriber.service';
import { logger } from '../../core/config';
import { SubscriptionService } from './subscription.service';
import { recordConversion } from '../../core/observability/metrics';
import { sanitizePhoneNumber } from '../subscriber/subscriber.utils';

export class StripeWebhookService {
  constructor(
    private subscriberService: SubscriberService,
    private stripeService: SubscriptionService,
    private stripeWebhookSecret: string
  ) {}

  async handleWebhookEvent(
    signature: string | string[] | undefined,
    rawBody: Buffer
  ): Promise<void> {
    let event: Stripe.Event;

    try {
      // 1. Verify the event signature
      if (!this.stripeWebhookSecret) {
        logger.error("STRIPE_WEBHOOK_SECRET is not set. Cannot verify Stripe webhooks.");
        throw new Error("Stripe webhook secret not configured.");
      }

      event = this.stripeService.constructEventFromWebhook(
        rawBody,
        signature,
        this.stripeWebhookSecret
      );
    } catch (err: any) {
      logger.error({ err }, "Stripe webhook signature verification failed.");
      throw err;
    }

    // 2. Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(event);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.created': // Handle created events too, if needed
        await this.handleSubscriptionChange(event);
        break;
      // Add more event types as needed
      default:
        logger.info({ eventType: event.type }, 'Unhandled Stripe event type.');
    }
  }

  private async handleCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    const subscriberId = session.client_reference_id;
    const stripeCustomerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

    if (!subscriberId || !stripeCustomerId) {
      logger.warn({ subscriberId, stripeCustomerId }, "Missing subscriberId or stripeCustomerId in checkout session completed event.");
      return;
    }

    // Update subscriber with Stripe Customer ID and set as premium
    // We assume subscriberId IS the phoneNumber (or whatever ID we used)
    try {
        // We use updateSubscriber because it handles creation if missing (though it shouldn't be missing here)
        // But wait, updateSubscriber takes a phoneNumber. client_reference_id is the phoneNumber.
        await this.subscriberService.updateSubscriber(subscriberId, {
            stripeCustomerId: stripeCustomerId,
            isPremium: true
        });
        logger.info({ subscriberId, stripeCustomerId }, "Linked Subscriber to Stripe Customer via Checkout Session.");
    } catch (err) {
        logger.error({ err, subscriberId }, "Failed to link subscriber in checkout session handler.");
    }
  }

  private async handleSubscriptionChange(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    let customerId: string;

    if (typeof subscription.customer === 'string') {
      customerId = subscription.customer;
    } else {
      customerId = (subscription.customer as Stripe.Customer).id;
    }

    const isPremium = subscription.status === 'active' || subscription.status === 'trialing';

    // 1. Try to find subscriber by Stripe Customer ID (Robust/New way)
    let subscriber = await this.subscriberService.getSubscriberByStripeCustomerId(customerId);

    let normalizedPhoneNumber: string | undefined;

    if (subscriber) {
        normalizedPhoneNumber = subscriber.connections.phone;
    } else {
        // 2. Fallback: Try to find by phone number in Stripe Customer (Legacy/Fallback)
        try {
            const customer = await this.stripeService.retrieveCustomer(customerId);
            const phoneNumber = customer.phone;
            if (phoneNumber) {
                normalizedPhoneNumber = sanitizePhoneNumber(phoneNumber);
                subscriber = await this.subscriberService.getSubscriber(normalizedPhoneNumber);
            }
        } catch (err) {
            logger.warn({ customerId, err }, "Could not retrieve customer details for fallback lookup.");
        }
    }

    if (!subscriber || !normalizedPhoneNumber) {
      logger.warn({ customerId }, "Could not find subscriber for subscription change event.");
      return;
    }

    // Record conversion metric if a non-premium user becomes premium
    if (!subscriber.isPremium && isPremium && !subscriber.isTestUser) {
        recordConversion();
        logger.info({ phoneNumber: normalizedPhoneNumber }, "Recorded new premium conversion.");
    }

    logger.info(
      { phoneNumber: normalizedPhoneNumber, subscriptionStatus: subscription.status, isPremium },
      `Stripe subscription change for ${normalizedPhoneNumber}. Setting isPremium to ${isPremium}.`
    );

    await this.subscriberService.updateSubscriber(normalizedPhoneNumber, { isPremium });
  }
}
