import { z } from 'zod';

export const TelegramUserSchema = z.object({
  id: z.number(),
  is_bot: z.boolean(),
  first_name: z.string(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});

export const TelegramChatSchema = z.object({
  id: z.number(),
  first_name: z.string().optional(),
  username: z.string().optional(),
  type: z.string(), // e.g., 'private'
});

export const TelegramMessageSchema = z.object({
  message_id: z.number(),
  from: TelegramUserSchema.optional(), // 'from' can be optional in some message types
  chat: TelegramChatSchema,
  date: z.number(), // Unix time
  text: z.string().optional(),
});

export const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: TelegramMessageSchema.optional(),
  // Add other update types as needed (edited_message, channel_post, etc.)
});

export type TelegramUser = z.infer<typeof TelegramUserSchema>;
export type TelegramChat = z.infer<typeof TelegramChatSchema>;
export type TelegramMessage = z.infer<typeof TelegramMessageSchema>;
export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;
