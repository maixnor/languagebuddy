import { WhatsAppService } from '../src/services/whatsapp-service';
import { logger } from '../src/config';

// Mock fetch globally
global.fetch = jest.fn();
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

// Mock logger
jest.mock('../../config', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }
}));

describe('WhatsAppService', () => {
  let whatsappService: WhatsAppService;
  const mockToken = 'test_token_123';
  const mockPhoneId = 'test_phone_id_456';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset singleton instance
    (WhatsAppService as any).instance = undefined;
    
    whatsappService = WhatsAppService.getInstance();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance when called multiple times', () => {
      const instance1 = WhatsAppService.getInstance();
      const instance2 = WhatsAppService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('initialize', () => {
    it('should initialize WhatsApp service with valid credentials', () => {
      whatsappService.initialize(mockToken, mockPhoneId);
      
      expect(whatsappService.isInitialized()).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('WhatsApp service initialized.');
    });

    it('should handle missing token gracefully', () => {
      whatsappService.initialize('', mockPhoneId);
      
      expect(whatsappService.isInitialized()).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not set. WhatsApp integration will be disabled.'
      );
    });

    it('should handle missing phone ID gracefully', () => {
      whatsappService.initialize(mockToken, '');
      
      expect(whatsappService.isInitialized()).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not set. WhatsApp integration will be disabled.'
      );
    });

    it('should handle both credentials missing', () => {
      whatsappService.initialize('', '');
      
      expect(whatsappService.isInitialized()).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not set. WhatsApp integration will be disabled.'
      );
    });
  });

  describe('getStatus', () => {
    it('should return correct status when initialized', () => {
      whatsappService.initialize(mockToken, mockPhoneId);
      
      const status = whatsappService.getStatus();
      expect(status).toEqual({
        initialized: true,
        token: true,
        phoneId: true
      });
    });

    it('should return correct status when not initialized', () => {
      const status = whatsappService.getStatus();
      expect(status).toEqual({
        initialized: false,
        token: false,
        phoneId: false
      });
    });
  });

  describe('sendMessage', () => {
    const toPhone = '1234567890';
    const messageText = 'Hello, this is a test message!';

    beforeEach(() => {
      whatsappService.initialize(mockToken, mockPhoneId);
    });

    it('should send message successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"success": true}'
      } as Response);

      const result = await whatsappService.sendMessage(toPhone, messageText);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://graph.facebook.com/v18.0/${mockPhoneId}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${mockToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: toPhone,
            text: { body: messageText }
          })
        }
      );
      expect(logger.info).toHaveBeenCalledWith(
        { phone: toPhone },
        'WhatsApp message sent successfully.'
      );
    });

    it('should send message with context when provided', async () => {
      const contextMessageId = 'msg_123';
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"success": true}'
      } as Response);

      const result = await whatsappService.sendMessage(toPhone, messageText, contextMessageId);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: toPhone,
            text: { body: messageText },
            context: { message_id: contextMessageId }
          })
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      const errorResponse = 'API Error: Invalid token';
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => errorResponse
      } as Response);

      const result = await whatsappService.sendMessage(toPhone, messageText);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        {
          phone: toPhone,
          status: 401,
          statusText: 'Unauthorized',
          responseBody: errorResponse
        },
        'Error sending WhatsApp message'
      );
    });

    it('should handle network errors gracefully', async () => {
      const networkError = new Error('Network error');
      mockFetch.mockRejectedValueOnce(networkError);

      const result = await whatsappService.sendMessage(toPhone, messageText);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        { err: networkError, phone: toPhone },
        'Exception sending WhatsApp message'
      );
    });

    it('should return false when service is not initialized', async () => {
      const uninitializedService = WhatsAppService.getInstance();
      
      const result = await uninitializedService.sendMessage(toPhone, messageText);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'WhatsApp service not initialized. Cannot send message.'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('markMessageAsRead', () => {
    const messageId = 'msg_123';

    beforeEach(() => {
      whatsappService.initialize(mockToken, mockPhoneId);
    });

    it('should mark message as read successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"success": true}'
      } as Response);

      const result = await whatsappService.markMessageAsRead(messageId);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://graph.facebook.com/v18.0/${mockPhoneId}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${mockToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId
          })
        }
      );
      expect(logger.info).toHaveBeenCalledWith(
        { messageId },
        'Message marked as read.'
      );
    });

    it('should handle API errors gracefully', async () => {
      const errorResponse = 'Message not found';
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => errorResponse
      } as Response);

      const result = await whatsappService.markMessageAsRead(messageId);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        {
          messageId,
          status: 404,
          statusText: 'Not Found',
          responseBody: errorResponse
        },
        'Error marking message as read'
      );
    });

    it('should return false when service is not initialized', async () => {
      const uninitializedService = WhatsAppService.getInstance();
      
      const result = await uninitializedService.markMessageAsRead(messageId);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'WhatsApp service not initialized. Cannot mark message as read.'
      );
    });
  });

  describe('sendTypingIndicator', () => {
    const toPhone = '1234567890';

    beforeEach(() => {
      whatsappService.initialize(mockToken, mockPhoneId);
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should send typing indicator successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"success": true}'
      } as Response);

      const promise = whatsappService.sendTypingIndicator(toPhone, 2000);
      
      // Fast-forward time
      jest.advanceTimersByTime(2000);
      
      const result = await promise;

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: toPhone,
            type: 'text',
            text: {
              preview_url: false,
              body: 'typing...'
            }
          })
        })
      );
    });

    it('should cap duration at 10 seconds', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"success": true}'
      } as Response);

      const promise = whatsappService.sendTypingIndicator(toPhone, 15000);
      
      // Should only advance 10 seconds, not 15
      jest.advanceTimersByTime(10000);
      
      const result = await promise;
      expect(result).toBe(true);
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Error'
      } as Response);

      const promise = whatsappService.sendTypingIndicator(toPhone);
      jest.advanceTimersByTime(3000);
      
      const result = await promise;

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        { phone: toPhone },
        'Failed to send typing indicator'
      );
    });
  });

  describe('sendMessageWithTyping', () => {
    const toPhone = '1234567890';
    const messageText = 'This is a test message with multiple words to calculate typing duration';

    beforeEach(() => {
      whatsappService.initialize(mockToken, mockPhoneId);
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should send typing indicator then message', async () => {
      // Mock successful responses for both typing indicator and message
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '{"success": true}'
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '{"success": true}'
        } as Response);

      const promise = whatsappService.sendMessageWithTyping(toPhone, messageText);
      
      // Fast-forward through typing duration
      jest.runAllTimers();
      
      const result = await promise;

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      
      // Verify typing indicator call
      expect(mockFetch).toHaveBeenNthCalledWith(1, 
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('typing...')
        })
      );
      
      // Verify message call
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: toPhone,
            text: { body: messageText }
          })
        })
      );
    });
  });

  describe('sendBulkMessages', () => {
    const messages = [
      { toPhone: '1111111111', text: 'Message 1' },
      { toPhone: '2222222222', text: 'Message 2' },
      { toPhone: '3333333333', text: 'Message 3', messageIdToContext: 'ctx_123' }
    ];

    beforeEach(() => {
      whatsappService.initialize(mockToken, mockPhoneId);
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should send all messages successfully', async () => {
      // Mock successful responses for all messages
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' } as Response)
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' } as Response)
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' } as Response);

      const promise = whatsappService.sendBulkMessages(messages);
      
      // Fast-forward through delays
      jest.runAllTimers();
      
      const result = await promise;

      expect(result).toEqual({
        successful: 3,
        failed: 0,
        results: [true, true, true]
      });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should handle partial failures', async () => {
      // Mock mixed responses
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' } as Response)
        .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'Error' } as Response)
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' } as Response);

      const promise = whatsappService.sendBulkMessages(messages);
      jest.runAllTimers();
      
      const result = await promise;

      expect(result).toEqual({
        successful: 2,
        failed: 1,
        results: [true, false, true]
      });
    });

    it('should handle network errors in bulk sending', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' } as Response)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' } as Response);

      const promise = whatsappService.sendBulkMessages(messages);
      jest.runAllTimers();
      
      const result = await promise;

      expect(result).toEqual({
        successful: 2,
        failed: 1,
        results: [true, false, true]
      });
    });
  });

  describe('Edge Cases and Integration', () => {
    it('should handle empty message text', async () => {
      whatsappService.initialize(mockToken, mockPhoneId);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}'
      } as Response);

      const result = await whatsappService.sendMessage('1234567890', '');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: '1234567890',
            text: { body: '' }
          })
        })
      );
    });

    it('should handle very long messages', async () => {
      whatsappService.initialize(mockToken, mockPhoneId);
      
      const longMessage = 'A'.repeat(4096); // Very long message
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}'
      } as Response);

      const result = await whatsappService.sendMessage('1234567890', longMessage);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: '1234567890',
            text: { body: longMessage }
          })
        })
      );
    });

    it('should handle concurrent initialization calls', () => {
      const service1 = WhatsAppService.getInstance();
      const service2 = WhatsAppService.getInstance();
      
      service1.initialize('token1', 'phone1');
      service2.initialize('token2', 'phone2');

      // Second initialization should be ignored due to singleton
      expect(service1.getStatus().token).toBe(true);
      expect(service2.getStatus().token).toBe(true);
      expect(service1).toBe(service2);
    });
  });
});