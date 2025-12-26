import { Request, Response, NextFunction } from 'express';
import { verifyTelegramSignature } from './telegram-webhook.middleware';

// Mock config
jest.mock('../../config', () => ({
  config: {
    telegram: {
      webhookSecret: 'test-secret',
    },
  },
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
  }
}));

describe('Telegram Webhook Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      sendStatus: jest.fn(),
    };
    mockNext = jest.fn();
  });

  it('should return 401 if X-Telegram-Bot-Api-Secret-Token header is missing', () => {
    verifyTelegramSignature(mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.sendStatus).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 403 if token is invalid', () => {
    mockReq.headers = {
      'x-telegram-bot-api-secret-token': 'invalid-token',
    };
    verifyTelegramSignature(mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.sendStatus).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call next() if token is valid', () => {
    mockReq.headers = {
      'x-telegram-bot-api-secret-token': 'test-secret',
    };
    verifyTelegramSignature(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.sendStatus).not.toHaveBeenCalled();
  });
});
