import { TelegramUpdate } from './telegram.types';
import { z } from 'zod';
import axios from 'axios';

import { logger } from '../../../core/observability/logging';

const SendMessageSchema = z.object({
  chat_id: z.number(),
  text: z.string(),
  parse_mode: z.string().optional(),
});

type SendMessagePayload = z.infer<typeof SendMessageSchema>;

export class TelegramService {
  private static instance: TelegramService;
  private readonly telegramApiUrl: string;

  private constructor() {
    const token = process.env.TELEGRAM_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_TOKEN environment variable not set.');
    }
    this.telegramApiUrl = `https://api.telegram.org/bot${token}`;
  }

  public static getInstance(): TelegramService {
    if (!TelegramService.instance) {
      TelegramService.instance = new TelegramService();
      logger.info('TelegramService initialized.');
    }
    return TelegramService.instance;
  }

  public async sendMessage(payload: SendMessagePayload): Promise<void> {
    try {
      SendMessageSchema.parse(payload);
      await axios.post(`${this.telegramApiUrl}/sendMessage`, payload);
      logger.info({ chat_id: payload.chat_id }, 'Telegram message sent successfully');
    } catch (error) {
      logger.error({ error, payload }, 'Failed to send Telegram message');
      throw error;
    }
  }

  public async setWebhook(url: string): Promise<void> {
    try {
      await axios.post(`${this.telegramApiUrl}/setWebhook`, { url });
      logger.info({ url }, 'Telegram webhook set successfully');
    } catch (error) {
      logger.error({ error, url }, 'Failed to set Telegram webhook');
      throw error;
    }
  }

  public async getMe(): Promise<any> {
    try {
      const response = await axios.get(`${this.telegramApiUrl}/getMe`);
      logger.info({ botInfo: response.data.result }, 'Telegram getMe successful');
      return response.data.result;
    } catch (error) {
      logger.error({ error }, 'Failed to get Telegram bot info');
      throw error;
    }
  }

  // Placeholder for processing incoming updates
  public async processUpdate(update: TelegramUpdate): Promise<void> {
    logger.info({ update_id: update.update_id }, 'Processing Telegram update');
    // This method will eventually delegate to the agent or other services
    // For now, let's just log and potentially send a test response.
    if (update.message?.text && update.message.chat.id) {
      await this.sendMessage({
        chat_id: update.message.chat.id,
        text: `Echo: ${update.message.text}`,
      });
    }
  }
}
