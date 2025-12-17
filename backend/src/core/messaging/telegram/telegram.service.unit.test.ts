import { TelegramService } from './telegram.service';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TelegramService', () => {
  let telegramService: TelegramService;
  const TELEGRAM_TOKEN = 'test_token';
  const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

  beforeAll(() => {
    process.env.TELEGRAM_TOKEN = TELEGRAM_TOKEN;
    telegramService = TelegramService.getInstance();
  });

  afterEach(() => {
    // Ensure the singleton instance is reset after each test to prevent side effects
    TelegramService['instance'] = undefined;
    process.env.TELEGRAM_TOKEN = TELEGRAM_TOKEN; // Restore token for subsequent tests
  });

  beforeEach(() => {
    mockedAxios.post.mockReset();
    mockedAxios.get.mockReset();
  });

  it('should be defined', () => {
    expect(telegramService).toBeDefined();
  });

  it('should throw an error if TELEGRAM_TOKEN is not set', () => {
    delete process.env.TELEGRAM_TOKEN;
    // Force a new instance to be created after deleting the token
    expect(() => TelegramService.getInstance()).toThrow('TELEGRAM_TOKEN environment variable not set.');
  });

  describe('sendMessage', () => {
    it('should send a message successfully', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { ok: true } });

      const payload = { chat_id: 123, text: 'Hello, Telegram!' };
      await telegramService.sendMessage(payload);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${TELEGRAM_API_URL}/sendMessage`,
        payload
      );
    });

    it('should throw an error if message sending fails', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

      const payload = { chat_id: 123, text: 'Hello, Telegram!' };
      await expect(telegramService.sendMessage(payload)).rejects.toThrow('Network error');
    });

    it('should validate the sendMessage payload', async () => {
      const invalidPayload = { chat_id: 'abc', text: 123 } as any; // Invalid types
      await expect(telegramService.sendMessage(invalidPayload)).rejects.toThrow();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('setWebhook', () => {
    it('should set the webhook successfully', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { ok: true } });

      const webhookUrl = 'https://example.com/telegram/webhook';
      await telegramService.setWebhook(webhookUrl);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${TELEGRAM_API_URL}/setWebhook`,
        { url: webhookUrl }
      );
    });

    it('should throw an error if setting webhook fails', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('API error'));

      const webhookUrl = 'https://example.com/telegram/webhook';
      await expect(telegramService.setWebhook(webhookUrl)).rejects.toThrow('API error');
    });
  });

  describe('getMe', () => {
    it('should retrieve bot info successfully', async () => {
      const botInfo = { id: 12345, is_bot: true, first_name: 'TestBot', username: 'test_bot' };
      mockedAxios.get.mockResolvedValueOnce({ data: { ok: true, result: botInfo } });

      const result = await telegramService.getMe();

      expect(mockedAxios.get).toHaveBeenCalledWith(`${TELEGRAM_API_URL}/getMe`);
      expect(result).toEqual(botInfo);
    });

    it('should throw an error if retrieving bot info fails', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Forbidden'));

      await expect(telegramService.getMe()).rejects.toThrow('Forbidden');
    });
  });

  describe('processUpdate', () => {
    it('should echo back a text message', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { ok: true } }); // For sendMessage

      const update = {
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 111, is_bot: false, first_name: 'User', username: 'testuser' },
          chat: { id: 123, type: 'private' },
          date: Date.now(),
          text: 'Hello, bot!',
        },
      };

      await telegramService.processUpdate(update);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${TELEGRAM_API_URL}/sendMessage`,
        { chat_id: 123, text: 'Echo: Hello, bot!' }
      );
    });

    it('should not send a message if update.message is missing or text is missing', async () => {
      const updateWithoutMessage = { update_id: 1 };
      const updateWithoutText = {
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 111, is_bot: false, first_name: 'User', username: 'testuser' },
          chat: { id: 123, type: 'private' },
          date: Date.now(),
          // No text field
        },
      };

      await telegramService.processUpdate(updateWithoutMessage);
      await telegramService.processUpdate(updateWithoutText);

      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });
});
