import { logger } from '../../../config';
import { markdownToWhatsApp, processMarkdownForWhatsApp, splitMessageBySeparator } from './whatsapp.message-formatters';
import { WhatsAppMessagePayload } from './whatsapp.types';

export class WhatsAppService {
  private static instance: WhatsAppService;
  private token: string | null = null;
  private phoneId: string | null = null;
  private cliEndpoint: string | null = null;

  private constructor() {
    // Check if CLI endpoint is configured
    this.cliEndpoint = process.env.USE_LOCAL_CLI_ENDPOINT || null;
  }

  static getInstance(): WhatsAppService {
    if (!WhatsAppService.instance) {
      WhatsAppService.instance = new WhatsAppService();
    }
    return WhatsAppService.instance;
  }

  initialize(token: string, phoneId: string): void {
    if (!token || !phoneId) {
      logger.error("WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not set. WhatsApp integration will be disabled.");
      this.token = null;
      this.phoneId = null;
      return;
    }
    this.token = token;
    this.phoneId = phoneId;

    if (this.cliEndpoint) {
      logger.info(`WhatsApp service initialized in CLI mode. Responses will be sent to: ${this.cliEndpoint}`);
    } else {
      logger.info("WhatsApp service initialized in normal mode.");
    }
  }

  async sendMessageRaw(toPhone: string, text: string, messageIdToContext?: string): Promise<boolean> {
    if (!this.token || !this.phoneId) {
      logger.error("WhatsApp service not initialized. Cannot send message.");
      return false;
    }

    if (this.cliEndpoint) {
      return this.sendMessageToCliRaw(toPhone, text);
    }

    // Regular WhatsApp API communication
    const payload: WhatsAppMessagePayload = {
      messaging_product: "whatsapp",
      to: toPhone,
      text: { body: text },
    };

    if (messageIdToContext) {
      payload.context = { message_id: messageIdToContext };
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${this.phoneId}/messages`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        const responseBody = await response.text();
        logger.error(
          { 
            phone: toPhone, 
            status: response.status, 
            statusText: response.statusText, 
            responseBody 
          },
          "Error sending WhatsApp message"
        );
        return false;
      }

      return true;
    } catch (error) {
      logger.error({ err: error, phone: toPhone }, "Exception sending WhatsApp message");
      return false;
    }
  }

  private async sendMessageToCliRaw(toPhone: string, text: string): Promise<boolean> {
    try {
      logger.info({ phone: toPhone }, "Sending message to CLI tool");

      const response = await fetch(this.cliEndpoint!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: this.phoneId,
          to: toPhone,
          text: text,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        logger.error({ statusCode: response.status }, "Failed to send message to CLI tool");
        return false;
      }

      logger.info("Message sent to CLI tool successfully");
      return true;
    } catch (error) {
      logger.error({ err: error }, "Error sending message to CLI tool");
      return false;
    }
  }

  async markMessageAsRead(messageId: string): Promise<boolean> {
    if (!this.token || !this.phoneId) {
      logger.error("WhatsApp service not initialized. Cannot mark message as read.");
      return false;
    }


    if (this.cliEndpoint) {
      return true; // No-op in CLI mode
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${this.phoneId}/messages`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            status: "read",
            message_id: messageId
          })
        }
      );

      if (!response.ok) {
        const responseBody = await response.text();
        logger.error(
          { 
            messageId, 
            status: response.status, 
            statusText: response.statusText, 
            responseBody 
          },
          "Error marking message as read"
        );
        return false;
      }
      return true;
    } catch (error) {
      logger.error({ err: error, messageId }, "Exception marking message as read");
      return false;
    }
  }

  /**
   * Main method to send messages with markdown conversion and separator splitting
   * @param toPhone The phone number to send to
   * @param text The text (markdown) that may contain separators
   * @param separator The separator to split by (default: '---')
   * @param messageIdToContext Optional message ID for context (applied only to first message)
   * @returns Results of sending all messages
   */
  async sendMessage(
    toPhone: string, 
    text: string, 
    separator: string = '---',
    messageIdToContext?: string
  ): Promise<{ successful: number; failed: number; results: boolean[] }> {
    // First convert markdown, then split
    const whatsappText = markdownToWhatsApp(text);
    const messages = splitMessageBySeparator(whatsappText, separator);
    
    if (messages.length === 0) {
      logger.warn("No messages to send after processing text");
      return { successful: 0, failed: 0, results: [] };
    }

    // For both single and multiple messages, send them as raw
    const results: boolean[] = [];
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < messages.length; i++) {
      try {
        // Only apply context to the first message, send as raw (already converted)
        const result = await this.sendMessageRaw(
          toPhone, 
          messages[i], 
          i === 0 ? messageIdToContext : undefined
        );
        results.push(result);
        
        if (result) {
          successful++;
        } else {
          failed++;
        }

        // Add small delay between messages to avoid rate limiting (skip for single message)
        if (i < messages.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        logger.error({ err: error, messageIndex: i }, "Error sending message");
        results.push(false);
        failed++;
      }
    }

    logger.trace({ total: messages.length, successful, failed }, "Message sending completed");
    return { successful, failed, results };
  }

  async sendBulkMessagesRaw(messages: Array<{
    toPhone: string;
    text: string;
    messageIdToContext?: string;
  }>): Promise<{ successful: number; failed: number; results: boolean[] }> {
    const results: boolean[] = [];
    let successful = 0;
    let failed = 0;

    for (const message of messages) {
      try {
        // Use sendMessageWithSeparators to handle markdown conversion
        // Note: This treats each message as potentially having separators
        const result = await this.sendMessage(
          message.toPhone, 
          message.text, 
          '---', // default separator
          message.messageIdToContext
        );
        
        // Flatten the results since each message could become multiple messages
        results.push(...result.results);
        successful += result.successful;
        failed += result.failed;

        // Add small delay between bulk messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error({ err: error, message }, "Error in bulk message sending");
        results.push(false);
        failed++;
      }
    }

    logger.trace({ total: messages.length, successful, failed }, "Bulk message sending completed");
    return { successful, failed, results };
  }

  isInitialized(): boolean {
    return !!(this.token && this.phoneId);
  }

  getStatus(): { initialized: boolean; token: boolean; phoneId: boolean } {
    return {
      initialized: this.isInitialized(),
      token: !!this.token,
      phoneId: !!this.phoneId
    };
  }
}
