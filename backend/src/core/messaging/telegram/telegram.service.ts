import { TelegramUpdate } from './telegram.types';
import { z } from 'zod';
import axios from 'axios';
import { BaseService } from '../../../services/base-service';
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
    }
    return TelegramService.instance;
  }

  public async sendMessage(payload: SendMessagePayload): Promise<void> {
    try {
      SendMessageSchema.parse(payload);
      await axios.post(`${this.telegramApiUrl}/sendMessage`, payload);
      logger.info('Telegram message sent successfully', { chat_id: payload.chat_id });
    } catch (error) {
      logger.error('Failed to send Telegram message', { error, payload });
      throw error;
    }
  }

  public async setWebhook(url: string): Promise<void> {
    try {
      await axios.post(`${this.telegramApiUrl}/setWebhook`, { url });
      logger.info('Telegram webhook set successfully', { url });
    } catch (error) {
      logger.error('Failed to set Telegram webhook', { error, url });
      throw error;
    }
  }

  public async getMe(): Promise<any> {
    try {
      const response = await axios.get(`${this.telegramApiUrl}/getMe`);
      logger.info('Telegram getMe successful', { botInfo: response.data.result });
      return response.data.result;
    } catch (error) {
      logger.error('Failed to get Telegram bot info', { error });
      throw error;
    }
  }

  // Placeholder for processing incoming updates
  public async processUpdate(update: TelegramUpdate): Promise<void> {
    logger.info('Processing Telegram update', { update_id: update.update_id });
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
