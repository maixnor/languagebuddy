import Stripe from 'stripe';
import { SubscriberService } from '../features/subscriber/subscriber.service';
import { logger } from '../../config';
import { SubscriptionService } from './subscription.service';

export class StripeWebhookService {
  constructor(
    private subscriberService: SubscriberService,
    private stripeService: StripeService,
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

  private async handleSubscriptionChange(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    const customer = subscription.customer as Stripe.Customer; // Customer ID might be string or object
    const phoneNumber = customer.phone; // Assuming phone number is stored on customer metadata or directly
    // Normalize the phone number to ensure it has exactly one leading '+'
    // Remove all leading '+' and then add a single '+'
    const normalizedPhoneNumber = '+' + phoneNumber.replace(/^\++/, '');

    if (!normalizedPhoneNumber) {
      logger.warn({ customerId: customer.id }, "Stripe customer without phone number. Cannot update subscriber.");
      return;
    }

    const isPremium = subscription.status === 'active' || subscription.status === 'trialing';

    logger.info(
      { phoneNumber: normalizedPhoneNumber, subscriptionStatus: subscription.status, isPremium },
      `Stripe subscription change for ${normalizedPhoneNumber}. Setting isPremium to ${isPremium}.`
    );

    await this.subscriberService.updateSubscriber(normalizedPhoneNumber, { isPremium });
  }
}
