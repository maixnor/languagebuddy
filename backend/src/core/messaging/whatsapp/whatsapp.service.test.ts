import { WhatsAppService } from './whatsapp.service';
import { logger } from '../../core/config';

// Mock logger
jest.mock('../../core/config', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    trace: jest.fn(),
  }
}));

// Mock fetch globally
global.fetch = jest.fn();

describe('WhatsAppService', () => {
  let service: WhatsAppService;
  const mockToken = 'mock_token';
  const mockPhoneId = 'mock_phone_id';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the singleton instance for fresh testing
    // @ts-ignore
    WhatsAppService.instance = undefined;
    service = WhatsAppService.getInstance();
    
    // Disable CLI mode for these tests by default
    // @ts-ignore
    service.cliEndpoint = null;
  });

  describe('initialize', () => {
    it('should initialize with token and phoneId', () => {
      service.initialize(mockToken, mockPhoneId);
      const status = service.getStatus();
      
      expect(status.initialized).toBe(true);
      expect(status.token).toBe(true);
      expect(status.phoneId).toBe(true);
    });

    it('should handle missing credentials gracefully', () => {
      service.initialize('', '');
      const status = service.getStatus();
      
      expect(status.initialized).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('sendMessageRaw', () => {
    beforeEach(() => {
      service.initialize(mockToken, mockPhoneId);
    });

    it('should return false if not initialized', async () => {
      // @ts-ignore
      service.token = null;
      const result = await service.sendMessageRaw('123', 'test');
      expect(result).toBe(false);
    });

    it('should send message successfully via WhatsApp API', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('success'),
      });

      const result = await service.sendMessageRaw('+1234567890', 'Hello World');

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(mockPhoneId),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `Bearer ${mockToken}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: "1234567890",
            text: { body: "Hello World" }
          })
        })
      );
    });

    it('should handle API errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn().mockResolvedValue('{"error": "message"}'),
      });

      const result = await service.sendMessageRaw('+1234567890', 'Hello World');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle network exceptions', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));

      const result = await service.sendMessageRaw('+1234567890', 'Hello World');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('sendMessage (with formatting)', () => {
    beforeEach(() => {
      service.initialize(mockToken, mockPhoneId);
    });

    it('should convert markdown and split messages', async () => {
      // Mock successful send
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('success'),
      });

      // A message with a separator
      const complexMessage = "Part 1\n---\nPart 2";
      
      const result = await service.sendMessage('+1234567890', complexMessage);

      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle failures in multi-part messages', async () => {
      // First success, second fail
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false, text: () => Promise.resolve("error") });

      const complexMessage = "Part 1\n---\nPart 2";
      
      const result = await service.sendMessage('+1234567890', complexMessage);

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
    });
  });
  
  describe('CLI Mode', () => {
     beforeEach(() => {
        // @ts-ignore
        WhatsAppService.instance = undefined;
        service = WhatsAppService.getInstance();
        
        // Force enable CLI mode
        // @ts-ignore
        service.cliEndpoint = "http://localhost:3000/cli";
        service.initialize(mockToken, mockPhoneId);
     });
     
     it('should send to CLI endpoint instead of WhatsApp API', async () => {
         (global.fetch as jest.Mock).mockResolvedValueOnce({
             ok: true,
             status: 200
         });
         
         const result = await service.sendMessageRaw('123', 'test');
         
         expect(result).toBe(true);
         expect(global.fetch).toHaveBeenCalledWith(
             "http://localhost:3000/cli",
             expect.objectContaining({
                 method: 'POST',
                 body: expect.stringContaining('"text":"test"')
             })
         );
     });
  });
});
