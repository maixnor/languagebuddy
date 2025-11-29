import { Redis } from 'ioredis';
import { WhatsappDeduplicationService } from './whatsapp-deduplication.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';

// Mock logger to avoid cluttering test output
jest.mock('../../../config', () => ({
  logger: {
    trace: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  }
}));

describe('WhatsappDeduplicationService', () => {
  let service: WhatsappDeduplicationService;
  let mockRedis: DeepMockProxy<Redis>;

  beforeEach(() => {
    // Clear singleton instance before each test (if possible, or just create new one)
    // Since it's a singleton, we might need to be careful. 
    // However, the getInstance logic checks for instance existence.
    // For testing purposes, we can force create a new instance if we exposed the constructor,
    // but since we can't easily reset the private static instance without reflection or changing code,
    // we will try to assume we can rely on the mocked redis for behavior isolation.
    
    mockRedis = mockDeep<Redis>();
    
    // @ts-ignore - accessing private constructor/resetting instance for testing
    WhatsappDeduplicationService.instance = undefined;
    
    service = WhatsappDeduplicationService.getInstance(mockRedis);
  });

  describe('isDuplicateMessage', () => {
    it('should return true if message ID exists in Redis', async () => {
      const messageId = 'msg_123';
      mockRedis.exists.mockResolvedValue(1); // 1 means exists

      const result = await service.isDuplicateMessage(messageId);

      expect(result).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith(`whatsapp:msgid:${messageId}`);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('should return false and set key if message ID does not exist', async () => {
      const messageId = 'msg_456';
      mockRedis.exists.mockResolvedValue(0); // 0 means does not exist

      const result = await service.isDuplicateMessage(messageId);

      expect(result).toBe(false);
      expect(mockRedis.exists).toHaveBeenCalledWith(`whatsapp:msgid:${messageId}`);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `whatsapp:msgid:${messageId}`,
        '1',
        'EX',
        expect.any(Number) // Checking that TTL is passed
      );
    });
  });

  describe('isThrottled', () => {
    it('should return true if phone throttle key exists', async () => {
      const phone = '1234567890';
      mockRedis.exists.mockResolvedValue(1);

      const result = await service.isThrottled(phone);

      expect(result).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith(`whatsapp:throttle:${phone}`);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('should return false and set throttle key if not throttled', async () => {
      const phone = '0987654321';
      mockRedis.exists.mockResolvedValue(0);

      const result = await service.isThrottled(phone);

      expect(result).toBe(false);
      expect(mockRedis.exists).toHaveBeenCalledWith(`whatsapp:throttle:${phone}`);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `whatsapp:throttle:${phone}`,
        '1',
        'EX',
        expect.any(Number)
      );
    });
  });
});
