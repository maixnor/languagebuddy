import { SubscriberService } from './subscriber.service';
import { DatabaseService } from '../../core/database';
import { Subscriber } from './subscriber.types';
import { v4 as uuid } from 'uuid';

describe('SubscriberService (CRUD Integration - SQLite)', () => {
  let subscriberService: SubscriberService;
  let dbService: DatabaseService;
  let phoneNumber: string;

  beforeAll(() => {
    dbService = new DatabaseService(':memory:');
    dbService.migrate(); // Apply migrations to create the subscribers table
    // Ensure the singleton instance is cleared before all tests
    (SubscriberService as any).instance = undefined;
    subscriberService = SubscriberService.getInstance(dbService);
  });

  afterAll(() => {
    dbService.close();
  });

  beforeEach(async () => {
    // Clear tables for a clean state before each test
    dbService.getDb().exec('DELETE FROM subscribers');
    dbService.getDb().exec('DELETE FROM daily_usage');
    // Ensure a unique phone number for each test
    phoneNumber = `+1${Math.floor(Math.random() * 10000000000)}`; 
  });

  it('should create and retrieve a subscriber', async () => {
    const newSubscriber = await subscriberService.createSubscriber(phoneNumber);
    expect(newSubscriber).toBeDefined();
    expect(newSubscriber.connections.phone).toBe(phoneNumber);
    expect(newSubscriber.status).toBe('onboarding');

    const retrievedSubscriber = await subscriberService.getSubscriber(phoneNumber);
    expect(retrievedSubscriber).toBeDefined();
    expect(retrievedSubscriber?.connections.phone).toBe(phoneNumber);
    expect(retrievedSubscriber?.profile.name).toBe('New User');
    expect(retrievedSubscriber?.status).toBe('onboarding');
  });

  it('should update an existing subscriber', async () => {
    await subscriberService.createSubscriber(phoneNumber);

    const updates: Partial<Subscriber> = {
      profile: {
        name: 'Updated Name',
        speakingLanguages: [],
        learningLanguages: [],
        timezone: 'America/New_York',
      },
      isPremium: true,
      status: 'active',
    };
    await subscriberService.updateSubscriber(phoneNumber, updates);

    const updatedSubscriber = await subscriberService.getSubscriber(phoneNumber);
    expect(updatedSubscriber).toBeDefined();
    expect(updatedSubscriber?.profile.name).toBe('Updated Name');
    expect(updatedSubscriber?.profile.timezone).toBe('America/New_York');
    expect(updatedSubscriber?.isPremium).toBe(true);
    expect(updatedSubscriber?.status).toBe('active');
  });

  it('should get all subscribers', async () => {
    const phone1 = `+1${Math.floor(Math.random() * 10000000000)}`;
    const phone2 = `+1${Math.floor(Math.random() * 10000000000)}`;

    await subscriberService.createSubscriber(phone1);
    await subscriberService.createSubscriber(phone2);

    const allSubscribers = await subscriberService.getAllSubscribers();
    expect(allSubscribers.length).toBeGreaterThanOrEqual(2); // Might have other test subscribers if not careful with cleanup
    expect(allSubscribers.some(s => s.connections.phone === phone1)).toBe(true);
    expect(allSubscribers.some(s => s.connections.phone === phone2)).toBe(true);
  });

  it('should handle non-existent subscribers gracefully for getSubscriber', async () => {
    const nonExistentPhone = '+19998887777';
    const subscriber = await subscriberService.getSubscriber(nonExistentPhone);
    expect(subscriber).toBeNull();
  });

  it('should use default status when creating subscriber if not explicitly provided', async () => {
    const subscriber = await subscriberService.createSubscriber(phoneNumber);
    expect(subscriber.status).toBe('onboarding');
  });

  it('should update status when updating subscriber', async () => {
    await subscriberService.createSubscriber(phoneNumber);
    await subscriberService.updateSubscriber(phoneNumber, { status: 'paused' });
    const updatedSubscriber = await subscriberService.getSubscriber(phoneNumber);
    expect(updatedSubscriber?.status).toBe('paused');
  });

  it('should correctly hydrate date fields after retrieval', async () => {
    const created = await subscriberService.createSubscriber(phoneNumber);
    expect(created.signedUpAt).toBeInstanceOf(Date);
    expect(created.lastActiveAt).toBeInstanceOf(Date);
    
    // Simulate re-fetching from DB
    const fetched = await subscriberService.getSubscriber(phoneNumber);
    expect(fetched?.signedUpAt).toBeInstanceOf(Date);
    expect(fetched?.lastActiveAt).toBeInstanceOf(Date);
  });

  it('should delete a subscriber', async () => {
    await subscriberService.createSubscriber(phoneNumber);
    let subscriber = await subscriberService.getSubscriber(phoneNumber);
    expect(subscriber).not.toBeNull();

    const result = await subscriberService.deleteSubscriber(phoneNumber);
    expect(result).toBe(true);

    subscriber = await subscriberService.getSubscriber(phoneNumber);
    expect(subscriber).toBeNull();
  });

  it('should return false when deleting a non-existent subscriber', async () => {
    const nonExistentPhone = '+19998887777';
    const result = await subscriberService.deleteSubscriber(nonExistentPhone);
    expect(result).toBe(false);
  });

  it('should save and retrieve referralSource', async () => {
    await subscriberService.createSubscriber(phoneNumber);
    
    // Test updating with referral source
    await subscriberService.updateSubscriber(phoneNumber, {
        profile: {
            name: 'Test User',
            speakingLanguages: [],
            learningLanguages: [],
            referralSource: 'reddit'
        }
    });

    let subscriber = await subscriberService.getSubscriber(phoneNumber);
    expect(subscriber?.profile.referralSource).toBe('reddit');

    // Test creating with referral source (simulating onboarding completion)
    const phone2 = `+1${Math.floor(Math.random() * 10000000000)}`;
    await subscriberService.createSubscriber(phone2, {
        profile: {
            name: 'Another User',
            speakingLanguages: [],
            learningLanguages: [],
            referralSource: 'maixnor'
        }
    });
    
    subscriber = await subscriberService.getSubscriber(phone2);
    expect(subscriber?.profile.referralSource).toBe('maixnor');
  });
});
