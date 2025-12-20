import { DatabaseService } from '../../core/database';
import { logger } from '../../core/config';
import { SubscriberService } from './subscriber.service';
import { Subscriber } from './subscriber.types';
import { DateTime } from 'luxon';

export class LinkService {
  private static instance: LinkService;
  private dbService: DatabaseService;
  private subscriberService: SubscriberService;

  private constructor(dbService: DatabaseService) {
    this.dbService = dbService;
    this.subscriberService = SubscriberService.getInstance();
  }

  static getInstance(dbService?: DatabaseService): LinkService {
    if (!LinkService.instance) {
      if (!dbService) {
        throw new Error("DatabaseService instance required for first initialization");
      }
      LinkService.instance = new LinkService(dbService);
    }
    return LinkService.instance;
  }

  /**
   * Generates a 6-digit link code for a subscriber and stores it.
   */
  public async generateLinkCode(phoneNumber: string): Promise<string> {
    try {
      // Generate a random 6-digit number
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Expire in 10 minutes
      const expiresAt = DateTime.now().plus({ minutes: 10 }).toUTC().toSQL();

      // Delete any existing codes for this user to keep it clean
      this.dbService.getDb().prepare('DELETE FROM link_codes WHERE subscriber_phone = ?').run(phoneNumber);

      this.dbService.getDb().prepare(`
        INSERT INTO link_codes (code, subscriber_phone, expires_at)
        VALUES (?, ?, ?)
      `).run(code, phoneNumber, expiresAt);

      logger.info({ phone: phoneNumber }, "Generated link code");
      return code;
    } catch (error) {
      logger.error({ err: error, phone: phoneNumber }, "Error generating link code");
      throw error;
    }
  }

  /**
   * Links the current subscriber (secondary) to the subscriber associated with the code (primary).
   * effectively merging secondary -> primary.
   */
  public async linkAccounts(code: string, currentSubscriberPhone: string): Promise<boolean> {
    try {
      // 1. Validate Code
      const row = this.dbService.getDb().prepare(`
        SELECT subscriber_phone, expires_at FROM link_codes WHERE code = ?
      `).get(code) as { subscriber_phone: string; expires_at: string } | undefined;

      if (!row) {
        logger.warn({ code, currentSubscriberPhone }, "Invalid link code");
        return false;
      }

      const expiresAt = DateTime.fromSQL(row.expires_at, { zone: 'utc' });
      if (expiresAt < DateTime.now().toUTC()) {
        logger.warn({ code, currentSubscriberPhone }, "Expired link code");
        return false;
      }

      const primaryPhone = row.subscriber_phone;

      // Prevent self-linking
      if (primaryPhone === currentSubscriberPhone) {
        logger.warn({ phone: currentSubscriberPhone }, "Attempted self-link");
        return false; // Or true with a message "You are already connected"
      }

      // 2. Fetch both subscribers
      const primarySubscriber = await this.subscriberService.getSubscriber(primaryPhone);
      const secondarySubscriber = await this.subscriberService.getSubscriber(currentSubscriberPhone);

      if (!primarySubscriber || !secondarySubscriber) {
        logger.error({ primaryPhone, currentSubscriberPhone }, "One of the subscribers not found during link");
        return false;
      }

      // 3. Merge Logic
      // We want to add secondary's connections to primary.
      const updatedConnections = { ...primarySubscriber.connections };
      
      // If secondary has telegram and primary doesn't, add it
      if (secondarySubscriber.connections.telegram && !updatedConnections.telegram) {
        updatedConnections.telegram = secondarySubscriber.connections.telegram;
      } else if (secondarySubscriber.connections.telegram && updatedConnections.telegram) {
          logger.warn({ primaryPhone, secondaryPhone: currentSubscriberPhone }, "Collision in Telegram connection during link. Keeping primary.");
      }

      // If secondary has whatsapp and primary doesn't, add it
      // Note: Assuming primarySubscriber.connections.phone is the WhatsApp phone if it originated from WhatsApp
      // or that the secondarySubscriber.connections.phone *is* the whatsapp.phone if the secondary came from WhatsApp.
      // We will explicitly use the whatsapp.phone from the secondarySubscriber if available and not present in primary.
      if (secondarySubscriber.connections.whatsapp && !updatedConnections.whatsapp) {
        updatedConnections.whatsapp = secondarySubscriber.connections.whatsapp;
      } else if (secondarySubscriber.connections.whatsapp && updatedConnections.whatsapp) {
          logger.warn({ primaryPhone, secondaryPhone: currentSubscriberPhone }, "Collision in WhatsApp connection during link. Keeping primary.");
      }

      // 4. Update Primary
      await this.subscriberService.updateSubscriber(primaryPhone, {
        connections: updatedConnections
      });

      // 5. Delete Secondary
      await this.subscriberService.deleteSubscriber(currentSubscriberPhone);

      // 6. Cleanup Code
      this.dbService.getDb().prepare('DELETE FROM link_codes WHERE code = ?').run(code);

      logger.info({ primaryPhone, secondaryPhone: currentSubscriberPhone }, "Accounts linked successfully");
      return true;

    } catch (error) {
      logger.error({ err: error, code, currentSubscriberPhone }, "Error linking accounts");
      throw error;
    }
  }
}
