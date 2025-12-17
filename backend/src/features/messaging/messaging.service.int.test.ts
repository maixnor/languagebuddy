import { MessagingService } from './messaging.service';
import { ServiceContainer } from '../../core/container';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { TelegramUpdate } from '../../core/messaging/telegram/telegram.types';
import express from 'express';

describe('MessagingService (Telegram Integration)', () => {
  let messagingService: MessagingService;
  let mockServices: DeepMockProxy<ServiceContainer>;
  let mockResponse: DeepMockProxy<express.Response>;

  beforeEach(() => {
    mockServices = mockDeep<ServiceContainer>();
    // Mock telegramService.processUpdate
    mockServices.telegramService.processUpdate.mockResolvedValue(undefined);

    messagingService = new MessagingService(mockServices);
    mockResponse = mockDeep<express.Response>();
  });

  describe('handleTelegramWebhookMessage', () => {
    it('should process a valid Telegram update and call telegramService.processUpdate', async () => {
      const telegramUpdate: TelegramUpdate = {
        update_id: 12345,
        message: {
          message_id: 1,
          from: { id: 111, is_bot: false, first_name: 'Test', username: 'testuser' },
          chat: { id: 123, type: 'private' },
          date: Date.now(),
          text: 'Hello Telegram!',
        },
      };

      await messagingService.handleTelegramWebhookMessage(telegramUpdate, mockResponse);

      expect(mockServices.telegramService.processUpdate).toHaveBeenCalledTimes(1);
      expect(mockServices.telegramService.processUpdate).toHaveBeenCalledWith(telegramUpdate);
      expect(mockResponse.sendStatus).toHaveBeenCalledWith(200);
    });

    it('should handle errors during processing and send a 400 status', async () => {
      const telegramUpdate: TelegramUpdate = {
        update_id: 12346,
        // Intentionally malformed update to trigger an error, or just mock the service to throw
      };

      mockServices.telegramService.processUpdate.mockRejectedValueOnce(new Error('Processing error'));

      await messagingService.handleTelegramWebhookMessage(telegramUpdate, mockResponse);

      expect(mockServices.telegramService.processUpdate).toHaveBeenCalledTimes(1);
      expect(mockServices.telegramService.processUpdate).toHaveBeenCalledWith(telegramUpdate);
      expect(mockResponse.sendStatus).toHaveBeenCalledWith(400);
    });
  });
});
