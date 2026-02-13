import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

export const patagonDb = createClient(env.PATAGON_SUPABASE_URL, env.PATAGON_SUPABASE_SERVICE_ROLE_KEY);
