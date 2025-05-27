import pino from 'pino';

let whatsappToken: string;
let whatsappPhoneId: string;
let logger: pino.Logger;

export function initWhatsApp(token: string, phoneId: string, pinoLogger: pino.Logger) {
  if (!token || !phoneId) {
    pinoLogger.error("WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not set. WhatsApp integration will be disabled.");
    // Potentially throw an error or handle this case as per application requirements
    return;
  }
  whatsappToken = token;
  whatsappPhoneId = phoneId;
  logger = pinoLogger;
  logger.info("WhatsApp client initialized.");
}

export async function sendWhatsAppMessage(toPhone: string, text: string, messageIdToContext?: string): Promise<boolean> {
  if (!whatsappToken || !whatsappPhoneId) {
    logger.error("WhatsApp client not initialized. Cannot send message.");
    return false;
  }
  const payload: any = {
    messaging_product: "whatsapp",
    to: toPhone,
    text: { body: text },
  };
  if (messageIdToContext) {
    payload.context = { message_id: messageIdToContext };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${whatsappPhoneId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${whatsappToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      logger.error(
        { phone: toPhone, status: response.status, statusText: response.statusText, responseBody: await response.text() },
        `Error sending WhatsApp message`
      );
      return false;
    }
    logger.info({ phone: toPhone }, `WhatsApp message sent successfully.`);
    return true;
  } catch (error) {
    logger.error({ err: error, phone: toPhone }, `Exception sending WhatsApp message`);
    return false;
  }
}

export async function markMessageAsRead(messageId: string): Promise<void> {
  if (!whatsappToken || !whatsappPhoneId) {
    logger.error("WhatsApp client not initialized. Cannot mark message as read.");
    return;
  }
  try {
    const readResponse = await fetch(
      `https://graph.facebook.com/v18.0/${whatsappPhoneId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${whatsappToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId
        })
      }
    );
    if (!readResponse.ok) {
      logger.error(
        { messageId, status: readResponse.status, statusText: readResponse.statusText, responseBody: await readResponse.text() },
        "Error marking message as read"
      );
    } else {
      logger.info({ messageId }, `Message marked as read.`);
    }
  } catch (error) {
    logger.error({ err: error, messageId }, `Exception marking message as read`);
  }
}
