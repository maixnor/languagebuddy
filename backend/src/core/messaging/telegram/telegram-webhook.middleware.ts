import { Request, Response, NextFunction } from 'express';
import { config } from '../../config';
import { logger } from '../../observability/logging';

export const verifyTelegramSignature = (req: Request, res: Response, next: NextFunction) => {
  const secretToken = req.headers['x-telegram-bot-api-secret-token'];
  const configuredSecret = config.telegram.webhookSecret;

  if (!configuredSecret) {
    logger.error('TELEGRAM_WEBHOOK_SECRET is not configured.');
    res.sendStatus(500);
    return;
  }

  if (!secretToken) {
    logger.warn('Missing X-Telegram-Bot-Api-Secret-Token header in Telegram webhook request.');
    res.sendStatus(401);
    return;
  }

  if (secretToken !== configuredSecret) {
    logger.warn('Invalid Telegram webhook secret token.');
    res.sendStatus(403);
    return;
  }

  next();
};
