import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

export const agentDb = createClient(env.AGENT_SUPABASE_URL, env.AGENT_SUPABASE_SERVICE_ROLE_KEY);
