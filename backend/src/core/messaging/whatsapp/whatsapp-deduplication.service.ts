import { Redis } from 'ioredis';
import { logger } from '../../config';

const MESSAGE_ID_TTL_SECONDS = 30 * 60; // 30 minutes
const THROTTLE_TTL_SECONDS = 5; // 5 seconds

export class WhatsappDeduplicationService {
  private static instance: WhatsappDeduplicationService;
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async isDuplicateMessage(messageId: string): Promise<boolean> {
    const key = `whatsapp:msgid:${messageId}`;
    const exists = await this.redis.exists(key);
    if (exists) {
      logger.trace({ messageId }, 'Duplicate message detected');
      return true;
    }
    await this.redis.set(key, '1', 'EX', MESSAGE_ID_TTL_SECONDS);
    return false;
  }

  async isThrottled(phone: string): Promise<boolean> {
    const key = `whatsapp:throttle:${phone}`;
    const exists = await this.redis.exists(key);
    if (exists) {
      logger.trace({ phone }, 'User is throttled');
      return true;
    }
    await this.redis.set(key, '1', 'EX', THROTTLE_TTL_SECONDS);
    return false;
  }

  static getInstance(redis: Redis) {
    if (!WhatsappDeduplicationService.instance) {
      if (!redis) {
        throw new Error("Redis instance required for first initialization");
      }
      WhatsappDeduplicationService.instance = new WhatsappDeduplicationService(redis);
    }
    return WhatsappDeduplicationService.instance;

  }
}
