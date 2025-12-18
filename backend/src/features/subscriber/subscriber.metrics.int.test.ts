import { SubscriberService } from './subscriber.service';
import { DatabaseService } from '../../core/database';
import { DateTime } from 'luxon';

describe('SubscriberService (Metrics Integration)', () => {
  let subscriberService: SubscriberService;
  let dbService: DatabaseService;
  let phoneNumber: string;

  beforeAll(() => {
    dbService = new DatabaseService(':memory:');
    dbService.migrate();
    (SubscriberService as any).instance = undefined;
    subscriberService = SubscriberService.getInstance(dbService);
  });

  afterAll(() => {
    dbService.close();
  });

  beforeEach(async () => {
    dbService.getDb().exec('DELETE FROM subscribers');
    phoneNumber = `+1${Math.floor(Math.random() * 10000000000)}`;
  });

  it('should count user as active if they have sent a message and no digest history exists', async () => {
    // 1. Create subscriber
    await subscriberService.createSubscriber(phoneNumber);
    
    // 2. Set lastMessageSentAt to now
    await subscriberService.updateSubscriber(phoneNumber, {
        lastMessageSentAt: new Date()
    });

    // 3. Count
    const count = await subscriberService.getActiveConversationsCount();
    expect(count).toBe(1);
  });

  it('should count user as active if lastMessageSentAt > lastNightlyDigestRun', async () => {
    // 1. Create subscriber
    await subscriberService.createSubscriber(phoneNumber);

    // 2. Set lastNightlyDigestRun to 2 hours ago
    const lastDigest = DateTime.now().minus({ hours: 2 }).toJSDate();
    
    // 3. Set lastMessageSentAt to 1 hour ago
    const lastMessage = DateTime.now().minus({ hours: 1 }).toJSDate();

    let sub = await subscriberService.getSubscriber(phoneNumber);
    if (!sub) throw new Error("Sub not found");
    
    await subscriberService.updateSubscriber(phoneNumber, {
        metadata: {
            ...sub.metadata,
            lastNightlyDigestRun: lastDigest
        },
        lastMessageSentAt: lastMessage
    });

    const count = await subscriberService.getActiveConversationsCount();
    expect(count).toBe(1);
  });

  it('should NOT count user as active if lastMessageSentAt < lastNightlyDigestRun', async () => {
    await subscriberService.createSubscriber(phoneNumber);

    const lastDigest = DateTime.now().minus({ hours: 1 }).toJSDate();
    const lastMessage = DateTime.now().minus({ hours: 2 }).toJSDate();

    let sub = await subscriberService.getSubscriber(phoneNumber);
    await subscriberService.updateSubscriber(phoneNumber, {
        metadata: {
            ...sub!.metadata,
            lastNightlyDigestRun: lastDigest
        },
        lastMessageSentAt: lastMessage
    });

    const count = await subscriberService.getActiveConversationsCount();
    expect(count).toBe(0);
  });

  it('should NOT count user as active if lastMessageSentAt is missing', async () => {
    await subscriberService.createSubscriber(phoneNumber);
    // New subscriber has no lastMessageSentAt
    const count = await subscriberService.getActiveConversationsCount();
    expect(count).toBe(0);
  });
});
