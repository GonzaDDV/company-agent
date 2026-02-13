import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string(),
  OPENROUTER_API_KEY: z.string(),
  AGENT_SUPABASE_URL: z.string().url(),
  AGENT_SUPABASE_SERVICE_ROLE_KEY: z.string(),
  PATAGON_SUPABASE_URL: z.string().url(),
  PATAGON_SUPABASE_SERVICE_ROLE_KEY: z.string(),
  MONDAY_API_TOKEN: z.string().optional(),
  DIGEST_CHAT_ID: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Environment validation failed:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
