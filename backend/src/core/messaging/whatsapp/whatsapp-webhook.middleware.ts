import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../../config';
import { logger } from '../../observability/logging';

export interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

export const verifyWhatsappSignature = (req: Request, res: Response, next: NextFunction) => {
  const reqWithRawBody = req as RequestWithRawBody;
  
  if (!reqWithRawBody.rawBody) {
    logger.error('Missing rawBody in WhatsApp webhook request. Middleware setup might be incorrect.');
    res.sendStatus(400);
    return;
  }

  const signature = req.headers['x-hub-signature-256'] as string;

  if (!signature) {
    logger.warn('Missing X-Hub-Signature-256 header in WhatsApp webhook request.');
    res.sendStatus(401);
    return;
  }

  const appSecret = config.whatsapp.appSecret;
  if (!appSecret) {
    logger.error('WHATSAPP_APP_SECRET is not configured.');
    res.sendStatus(500);
    return;
  }

  try {
    const elements = signature.split('=');
    const method = elements[0];
    const signatureHash = elements[1];

    const expectedHash = crypto
      .createHmac('sha256', appSecret)
      .update(reqWithRawBody.rawBody)
      .digest('hex');

    const signatureBuffer = Buffer.from(signatureHash);
    const expectedHashBuffer = Buffer.from(expectedHash);

    const valid = signatureHash && 
                  signatureBuffer.length === expectedHashBuffer.length && 
                  crypto.timingSafeEqual(signatureBuffer, expectedHashBuffer);

    if (!valid) {
      logger.warn('Invalid WhatsApp webhook signature.');
      res.sendStatus(403);
      return;
    }

    next();
  } catch (error) {
    logger.error({ err: error }, 'Error verifying WhatsApp webhook signature');
    res.sendStatus(500);
  }
};
