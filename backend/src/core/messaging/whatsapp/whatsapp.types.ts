export interface WhatsAppMessagePayload {
  messaging_product: string;
  to: string;
  text: { body: string };
  context?: { message_id: string };
}
