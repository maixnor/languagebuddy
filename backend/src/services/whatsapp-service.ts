import { logger } from '../config';

export interface WhatsAppMessagePayload {
  messaging_product: string;
  to: string;
  text: { body: string };
  context?: { message_id: string };
}

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

  async sendMessage(toPhone: string, text: string, messageIdToContext?: string): Promise<boolean> {
    if (!this.token || !this.phoneId) {
      logger.error("WhatsApp service not initialized. Cannot send message.");
      return false;
    }

    // If CLI endpoint is configured, send message there instead of WhatsApp API
    if (this.cliEndpoint) {
      return this.sendMessageToCli(toPhone, text);
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

  /**
   * Sends a message to the CLI tool instead of the WhatsApp API
   */
  private async sendMessageToCli(toPhone: string, text: string): Promise<boolean> {
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
        logger.warn({ statusCode: response.status }, "Failed to send message to CLI tool");
        return false;
      }

      logger.info("Message sent to CLI tool successfully");
      return true;
    } catch (error) {
      logger.warn({ err: error }, "Error sending message to CLI tool");
      return false;
    }
  }

  async markMessageAsRead(messageId: string): Promise<boolean> {
    if (!this.token || !this.phoneId) {
      logger.error("WhatsApp service not initialized. Cannot mark message as read.");
      return false;
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

  async sendTypingIndicator(toPhone: string, durationMs: number = 3000): Promise<boolean> {
    if (!this.token || !this.phoneId) {
      logger.error("WhatsApp service not initialized. Cannot send typing indicator.");
      return false;
    }

    try {
      // Send typing indicator
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
            recipient_type: "individual",
            to: toPhone,
            type: "text",
            text: {
              preview_url: false,
              body: "typing..."
            }
          })
        }
      );

      if (!response.ok) {
        logger.warn({ phone: toPhone }, "Failed to send typing indicator");
        return false;
      }

      // Wait for specified duration
      await new Promise(resolve => setTimeout(resolve, Math.min(durationMs, 10000))); // Cap at 10 seconds

      logger.debug({ phone: toPhone, durationMs }, "Typing indicator sent");
      return true;
    } catch (error) {
      logger.error({ err: error, phone: toPhone }, "Exception sending typing indicator");
      return false;
    }
  }

  async sendMessageWithTyping(toPhone: string, text: string, messageIdToContext?: string): Promise<boolean> {
    // Calculate typing duration based on message length (simulate realistic typing)
    const wordsCount = text.split(' ').length;
    const typingDuration = Math.min(wordsCount * 200, 8000); // 200ms per word, max 8 seconds

    // Send typing indicator first
    await this.sendTypingIndicator(toPhone, typingDuration);

    // Then send the actual message
    return this.sendMessage(toPhone, text, messageIdToContext);
  }

  async sendBulkMessages(messages: Array<{
    toPhone: string;
    text: string;
    messageIdToContext?: string;
  }>): Promise<{ successful: number; failed: number; results: boolean[] }> {
    const results: boolean[] = [];
    let successful = 0;
    let failed = 0;

    for (const message of messages) {
      try {
        const result = await this.sendMessage(message.toPhone, message.text, message.messageIdToContext);
        results.push(result);
        
        if (result) {
          successful++;
        } else {
          failed++;
        }

        // Add small delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error({ err: error, message }, "Error in bulk message sending");
        results.push(false);
        failed++;
      }
    }

    logger.info({ total: messages.length, successful, failed }, "Bulk message sending completed");
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