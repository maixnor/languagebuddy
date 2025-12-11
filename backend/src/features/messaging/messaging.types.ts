export interface WebhookMessage {
  id: string;
  from: string;
  type: string;
  text?: {
    body: string;
  };
}