import { MessagingService } from '../messaging/messaging.service';
import { SubscriberService } from './subscriber.service';
import { LinkService } from './subscriber-link.service';
import { DatabaseService } from '../../core/database';
import { ServiceContainer } from '../../core/container';
import { LanguageBuddyAgent } from '../../agents/language-buddy-agent';
import { WhatsAppService } from '../../core/messaging/whatsapp/whatsapp.service';
import { TelegramService } from '../../core/messaging/telegram/telegram.service';
import { Subscriber } from './subscriber.types';
import { config } from '../../core/config';

// Mock external dependencies
const mockWhatsappService = {
    sendMessage: jest.fn(),
    markMessageAsRead: jest.fn(),
};

const mockTelegramService = {
    sendMessage: jest.fn(),
    setWebhook: jest.fn(),
    getMe: jest.fn(),
};

const mockLanguageBuddyAgent = {
    initiateConversation: jest.fn().mockResolvedValue({ response: 'Agent initiated', updatedSubscriber: {} as Subscriber }),
    processUserMessage: jest.fn().mockResolvedValue({ response: 'Agent processed', updatedSubscriber: {} as Subscriber }),
    clearConversation: jest.fn(),
    currentlyInActiveConversation: jest.fn().mockResolvedValue(false),
    oneShotMessage: jest.fn((message: string) => Promise.resolve(message)), // Simply echo for now
    isOnboardingConversation: jest.fn().mockResolvedValue(false),
};

const mockWhatsappDeduplicationService = {
    recordMessageProcessed: jest.fn().mockResolvedValue(false),
};

// Minimal mock config for testing
config.dbPath = ':memory:'; // Use in-memory SQLite for tests
config.whatsapp = { token: 'mock-token', phoneId: 'mock-phone-id' };
config.publicBaseUrl = 'http://localhost';
config.stripe = { secretKey: 'sk_test_mock', webhookSecret: 'whsec_mock' };
config.subscription = { trialDays: 7 };


describe('Subscriber Linking Integration Tests', () => {
    let dbService: DatabaseService;
    let serviceContainer: ServiceContainer;
    let messagingService: MessagingService;
    let subscriberService: SubscriberService;
    let linkService: LinkService;

    beforeAll(() => {
        // Initialize config. This should happen once for all tests.
        // It's already mocked above
    });

    beforeEach(async () => {
        // Clear mocks before each test
        jest.clearAllMocks();
        // Clear global instance to ensure fresh setup
        (SubscriberService as any)['instance'] = undefined;
        (LinkService as any)['instance'] = undefined;
        (WhatsAppService as any)['instance'] = undefined;
        (TelegramService as any)['instance'] = undefined;

        // Use a new in-memory database for each test
        dbService = new DatabaseService(':memory:');
        
        serviceContainer = new ServiceContainer();
        // Manually assign mocks and real instances
        serviceContainer.dbService = dbService;
        serviceContainer.subscriberService = SubscriberService.getInstance(dbService);
        serviceContainer.linkService = LinkService.getInstance(dbService);
        serviceContainer.languageBuddyAgent = mockLanguageBuddyAgent as any;
        serviceContainer.whatsappService = mockWhatsappService as any;
        serviceContainer.telegramService = mockTelegramService as any;
        serviceContainer.whatsappDeduplicationService = mockWhatsappDeduplicationService as any;
        // Mock other services not directly used in linking flow but required by container
        serviceContainer.onboardingService = { /* minimal mock */ } as any;
        serviceContainer.feedbackService = { /* minimal mock */ } as any;
        serviceContainer.digestService = { /* minimal mock */ } as any;
        serviceContainer.subscriptionService = { /* minimal mock */ } as any;
        serviceContainer.subscriptionWebhookService = { /* minimal mock */ } as any;
        serviceContainer.schedulerService = { /* minimal mock */ } as any;
        serviceContainer.checkpointSaver = { /* minimal mock */ } as any;
        serviceContainer.llm = { /* minimal mock */ } as any;

        // Re-initialize messagingService with the new container
        messagingService = new MessagingService(serviceContainer);
        subscriberService = serviceContainer.subscriberService;
        linkService = serviceContainer.linkService;

        // Ensure the db is clean and migrated for each test
        // The DatabaseService constructor already calls migrate(), so just ensure a clean state
    });

    afterEach(async () => {
        // Close the database connection after each test
        dbService.close();
    });

    // Helper to simulate receiving a WhatsApp message
    const simulateWhatsappMessage = async (from: string, text: string) => {
        const messageId = `wamid.${Date.now()}`;
        const body = {
            entry: [{
                changes: [{
                    value: {
                        messages: [{
                            id: messageId,
                            from: from,
                            type: 'text',
                            text: { body: text }
                        }]
                    }
                }]
            }]
        };
        const mockRes = { sendStatus: jest.fn() };
        await messagingService.handleWebhookMessage(body, mockRes as any);
        return mockRes;
    };

    // Helper to simulate receiving a Telegram message
    const simulateTelegramMessage = async (chatId: number, text: string, username: string = 'tg_user') => {
        const body = {
            update_id: Date.now(),
            message: {
                chat: { id: chatId },
                text: text,
                from: { username: username }
            }
        };
        const mockRes = { sendStatus: jest.fn() };
        await messagingService.handleTelegramWebhookMessage(body, mockRes as any);
        return mockRes;
    };

    // --- Test Cases ---

    it('should link a WhatsApp account to a Telegram account (WhatsApp requests link)', async () => {
        const whatsappPhone = '+11111111111';
        const telegramChatId = 222222222;
        const telegramUsername = 'telegram_user_2';

        // 1. Simulate WhatsApp user requesting a link code
        // This will create a WhatsApp subscriber
        await simulateWhatsappMessage(whatsappPhone, '!link');

        // Extract the generated code from the WhatsAppService.sendMessage mock call
        expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(
            whatsappPhone,
            expect.stringContaining('!link ')
        );
        const linkCodeWhatsappMessage = mockWhatsappService.sendMessage.mock.calls[0][1];
        const whatsappLinkCode = linkCodeWhatsappMessage.match(/!link (\d{6})/)?.[1];
        expect(whatsappLinkCode).toBeDefined();

        // 2. Simulate Telegram user (new or existing) consuming the link code
        // This will create a Telegram subscriber, then link it
        await simulateTelegramMessage(telegramChatId, `!link ${whatsappLinkCode}`, telegramUsername);

        // Expect accounts to be linked and old Telegram subscriber deleted
        expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ chat_id: telegramChatId, text: expect.stringContaining('✅ Accounts linked successfully!') })
        );

        // Verify that the WhatsApp subscriber now has the Telegram connection details
        const primarySubscriber = await subscriberService.getSubscriber(whatsappPhone);
        expect(primarySubscriber).toBeDefined();
        expect(primarySubscriber?.connections.telegram).toEqual({ chatId: telegramChatId, username: `@${telegramUsername}` });

        // Verify the original Telegram pseudo-subscriber (if created) is deleted
        const secondarySubscriber = await subscriberService.getSubscriber(`+${telegramChatId}`);
        expect(secondarySubscriber).toBeNull();
    });

    it('should link a Telegram account to a WhatsApp account (Telegram requests link)', async () => {
        const telegramChatId = 333333333;
        const telegramUsername = 'telegram_user_3';
        const whatsappPhone = '+44444444444';

        // 1. Simulate Telegram user requesting a link code
        // This will create a Telegram subscriber
        await simulateTelegramMessage(telegramChatId, '!link', telegramUsername);

        // Extract the generated code from the TelegramService.sendMessage mock call
        expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ text: expect.stringContaining('!link ') })
        );
        const linkCodeTelegramMessage = mockTelegramService.sendMessage.mock.calls[0][0].text;
        const telegramLinkCode = linkCodeTelegramMessage.match(/!link (\d{6})/)?.[1];
        expect(telegramLinkCode).toBeDefined();

        // 2. Simulate WhatsApp user (new or existing) consuming the link code
        // This will create a WhatsApp subscriber, then link it
        await simulateWhatsappMessage(whatsappPhone, `!link ${telegramLinkCode}`);

        // Expect accounts to be linked and old WhatsApp subscriber deleted (if one was created)
        expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(
            whatsappPhone,
            expect.stringContaining('✅ Accounts linked successfully!')
        );

        // Verify that the Telegram subscriber (primary) retains its original phone,
        // and now has the WhatsApp connection details
        const primarySubscriber = await subscriberService.getSubscriber(`+${telegramChatId}`);
        expect(primarySubscriber).toBeDefined();
        expect(primarySubscriber?.connections.phone).toEqual(`+${telegramChatId}`); // Primary phone remains Telegram pseudo-phone
        expect(primarySubscriber?.connections.telegram).toEqual({ chatId: telegramChatId, username: `@${telegramUsername}` });
        expect(primarySubscriber?.connections.whatsapp).toEqual({ phone: whatsappPhone }); // New WhatsApp connection

        // Verify the original WhatsApp subscriber (secondary) is deleted
        const secondarySubscriber = await subscriberService.getSubscriber(whatsappPhone);
        expect(secondarySubscriber).toBeNull(); // Should be deleted as it was merged into Telegram one
    });

    it('should allow an onboarding WhatsApp user to issue a !link {code} command successfully', async () => {
        const primaryWhatsappPhone = '+55555555555'; // Existing subscriber who generates the code
        const newWhatsappUserPhone = '+66666666666'; // New user, will be onboarding and consuming code

        // 1. Simulate an existing WhatsApp user requesting a link code
        // This will create primaryWhatsappPhone subscriber
        await simulateWhatsappMessage(primaryWhatsappPhone, '!link');

        expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(
            primaryWhatsappPhone,
            expect.stringContaining('!link ')
        );
        const linkCodeMessage = mockWhatsappService.sendMessage.mock.calls[0][1];
        const linkCode = linkCodeMessage.match(/!link (\d{6})/)?.[1];
        expect(linkCode).toBeDefined();
        
        // Ensure primaryWhatsappPhone is a real subscriber
        let primarySubscriber = await subscriberService.getSubscriber(primaryWhatsappPhone);
        expect(primarySubscriber).toBeDefined();
        expect(primarySubscriber?.connections.whatsapp).toEqual({ phone: primaryWhatsappPhone });

        // 2. Simulate a new WhatsApp user consuming the link code
        // This user does NOT exist yet, so createSubscriber will be called internally.
        // It will then issue the !link command during onboarding.
        mockWhatsappService.sendMessage.mockClear(); // Clear previous send message mocks
        await simulateWhatsappMessage(newWhatsappUserPhone, `!link ${linkCode}`);

        // Expect successful linking message to the new user
        expect(mockWhatsappService.sendMessage).toHaveBeenCalledWith(
            newWhatsappUserPhone,
            expect.stringContaining('✅ Accounts linked successfully!')
        );

        // Verify the primary subscriber now has its original WhatsApp connection
        // (no change here, as secondary was also WhatsApp)
        // No, the original primary was WhatsApp, so the secondary's connection will be removed.
        // The expectation is that the primary subscriber exists and the secondary is gone.
        // What we need to check is if the original primary subscriber is still there,
        // and that the new user (secondary) is gone.
        
        primarySubscriber = await subscriberService.getSubscriber(primaryWhatsappPhone);
        expect(primarySubscriber).toBeDefined();
        // Its connections should remain the same as before, as it was already a WhatsApp account
        expect(primarySubscriber?.connections.phone).toEqual(primaryWhatsappPhone);
        expect(primarySubscriber?.connections.whatsapp).toEqual({ phone: primaryWhatsappPhone });
        
        // Verify the new user (secondary) is deleted
        const secondarySubscriber = await subscriberService.getSubscriber(newWhatsappUserPhone);
        expect(secondarySubscriber).toBeNull();
    });
});