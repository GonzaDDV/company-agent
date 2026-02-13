import type Anthropic from '@anthropic-ai/sdk';
import { patagonDb } from '../db/patagon-db.js';

export const patagonDbToolDef: Anthropic.Tool = {
  name: 'query_patagon_db',
  description: `Query the Patagon Markets database (read-only). Available tables and key columns:

- markets: id, company_name, ticker, status, share_price, valuation, min_investment, created_at
- deals: id, market_id, spv_name, status, created_at
- purchases: id, user_id, market_id, deal_id, amount, shares, status, signing_status, created_at
- positions: id, user_id, market_id, deal_id, shares, cost_basis, status, created_at
- investor_profiles: id, user_id, full_name, email, investor_type, entity_type, kyc_status, created_at
- sell_interests: id, user_id, market_id, shares, asking_price, status, created_at

Use standard PostgreSQL SELECT queries. Only SELECT is allowed. Prefer aggregations over raw dumps.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      sql: { type: 'string', description: 'The SELECT query to execute' },
      explanation: { type: 'string', description: 'Brief explanation of what this query does' },
    },
    required: ['sql', 'explanation'],
  },
};

const BLOCKED_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE)\b/i;

export async function executePatagonDb(input: Record<string, unknown>): Promise<string> {
  const sql = (input.sql as string).trim();

  if (!sql.toUpperCase().startsWith('SELECT')) {
    return 'Error: Only SELECT queries are allowed.';
  }

  if (BLOCKED_KEYWORDS.test(sql)) {
    return 'Error: Mutation queries are not allowed.';
  }

  const { data, error } = await patagonDb.rpc('execute_readonly_query', { query_text: sql });

  if (error) return `Query error: ${error.message}`;
  if (!data || (Array.isArray(data) && data.length === 0)) return 'Query returned no results.';

  return JSON.stringify(data, null, 2);
}
