import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { verifyWhatsappSignature, RequestWithRawBody } from './whatsapp-webhook.middleware';

// Mock config
jest.mock('../../config', () => ({
  config: {
    whatsapp: {
      appSecret: 'test-secret',
    },
  },
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
  }
}));

describe('WhatsApp Webhook Middleware', () => {
  let mockReq: Partial<RequestWithRawBody>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {},
      rawBody: Buffer.from(JSON.stringify({ test: 'data' })),
    };
    mockRes = {
      sendStatus: jest.fn(),
    };
    mockNext = jest.fn();
  });

  it('should return 401 if X-Hub-Signature-256 header is missing', () => {
    verifyWhatsappSignature(mockReq as any, mockRes as Response, mockNext);
    expect(mockRes.sendStatus).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 403 if signature is invalid', () => {
    mockReq.headers = {
      'x-hub-signature-256': 'sha256=invalidSignature',
    };
    verifyWhatsappSignature(mockReq as any, mockRes as Response, mockNext);
    expect(mockRes.sendStatus).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call next() if signature is valid', () => {
    const signature = crypto
      .createHmac('sha256', 'test-secret')
      .update(mockReq.rawBody!)
      .digest('hex');

    mockReq.headers = {
      'x-hub-signature-256': `sha256=${signature}`,
    };

    verifyWhatsappSignature(mockReq as any, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.sendStatus).not.toHaveBeenCalled();
  });

  it('should return 400 if rawBody is missing', () => {
    mockReq.rawBody = undefined;
    verifyWhatsappSignature(mockReq as any, mockRes as Response, mockNext);
    expect(mockRes.sendStatus).toHaveBeenCalledWith(400); // Or 500 depending on implementation preference
    expect(mockNext).not.toHaveBeenCalled();
  });
});
