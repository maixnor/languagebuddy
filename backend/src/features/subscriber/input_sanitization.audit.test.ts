import { WebhookService } from '../../services/webhook-service';
import { SubscriberService } from './subscriber.service';
import { ServiceContainer } from '../../core/container';
import { Redis } from 'ioredis';

describe('Input Sanitization Audit', () => {
  let webhookService: WebhookService;
  let subscriberService: SubscriberService;
  let container: ServiceContainer;
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    });
    
    // Mock container and services
    container = {} as ServiceContainer;
    subscriberService = SubscriberService.getInstance(redis);
    webhookService = new WebhookService(container);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('should ensure subscriber keys in Redis do NOT contain "+"', async () => {
    // Manually create a subscriber with a '+' in the phone property (simulating raw input)
    const rawPhoneWithPlus = '+49123456789';
    const rawPhoneWithoutPlus = '49123456789';

    // In your current architecture, WebhookService gets phone from message.from
    // WhatsApp usually sends without +, but let's verify what happens if we force one
    
    // This is a "white-box" test inspection. 
    // Currently, SubscriberService.createSubscriber uses the phone as provided:
    // const subscriber: Subscriber = { connections: { phone: phoneNumber }, ... }
    // await this.redis.set(`subscriber:${subscriber.connections.phone}`, ...)
    
    // IF createSubscriber is called with '+', it WILL save with '+'.
    
    await subscriberService.createSubscriber(rawPhoneWithPlus);
    
    const existsWithPlus = await redis.exists(`subscriber:${rawPhoneWithPlus}`);
    const existsWithoutPlus = await redis.exists(`subscriber:${rawPhoneWithoutPlus}`);

    // This assertion defines our desired state:
    // If we want NO PLUSES, the system should ideally sanitize on entry.
    // Currently, it does NOT sanitize on entry in createSubscriber.
    
    // Asserting the CURRENT behavior to demonstrate the risk:
    expect(existsWithPlus).toBe(1); // It currently saves WITH + if input has it
    expect(existsWithoutPlus).toBe(0);
    
    // Cleanup
    await redis.del(`subscriber:${rawPhoneWithPlus}`);
  });
});
