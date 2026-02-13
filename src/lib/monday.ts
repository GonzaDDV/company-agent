import { env } from '../config/env.js';

const MONDAY_API_URL = 'https://api.monday.com/v2';

// ─── API Client ─────────────────────────────────────────────────────────────

export async function queryMonday<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  if (!env.MONDAY_API_TOKEN) {
    throw new Error('MONDAY_API_TOKEN is not configured');
  }

  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: env.MONDAY_API_TOKEN,
      'API-Version': '2024-10',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Monday.com API error: ${response.status}`);
  }

  const json = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors) {
    throw new Error(`Monday.com GraphQL error: ${json.errors[0]?.message}`);
  }

  return json.data as T;
}

// ─── Board IDs ──────────────────────────────────────────────────────────────

export const BOARD_IDS = {
  clients: '5090824346',
  clientSubitems: '5090824356',
  deals: '5090824347',
  subscriptions: '5090838909',
  companies: '5090840337',
  activities: '5090824343',
  investmentEntities: '5090838894',
  spvEntities: '5090841915',
  quotesInvoices: '5090824349',
} as const;

// ─── Column Mappings (column_id → human-readable field name) ────────────────

export const COLUMN_MAP: Record<string, Record<string, string>> = {
  clients: {
    text_mm00b841: 'alias',
    contact_email: 'email',
    contact_phone: 'phone',
    numeric_mm00ha7d: 'est_net_worth',
    numeric_mm002v0q: 'est_liquid_net_worth',
    dropdown_mm005vxj: 'client_type',
    multiple_person_mm00zpxa: 'closest_relationship',
    text_mm0092tw: 'address',
    text_mm00fmg7: 'zip_code',
    text_mm001b7r: 'city',
    text_mm00h9s6: 'state',
    text_mm00mp6c: 'country',
    date_mm00xaek: 'date_added',
    board_relation_mm00b8wq: 'subscriptions_rel',
    contact_deal: 'deals_rel',
    board_relation_mm00j0a2: 'investment_entities_rel',
  },
  clientSubitems: {
    date0: 'date',
    text_mm02cky4: 'location',
    text_mm02dkee: 'team_member',
  },
  deals: {
    deal_value: 'deal_size',
    numeric_mm00fck9: 'management_fee_pct',
    numeric_mm00r3kz: 'carry_pct',
    numeric_mm002rb: 'other_fees_pct',
    text_mm006z9x: 'notes',
    board_relation_mm00jt9f: 'spv_rel',
    board_relation_mm0063n9: 'companies_rel',
    board_relation_mm007y5t: 'subscriptions_rel',
  },
  subscriptions: {
    numeric_mm00q6hx: 'subscription_amount',
    numeric_mm008x5q: 'management_fee_pct',
    numeric_mm00t7ev: 'carry_pct',
    numeric_mm00rnp: 'other_fees_pct',
    text_mm00bt3d: 'notes',
    multiple_person_mm00wqvv: 'owner',
    boolean_mm00xjv5: 'non_us',
    dropdown_mm00twm7: 'documents_intake',
    boolean_mm00rsda: 'transferred',
    board_relation_mm003ayv: 'client_rel',
    board_relation_mm009z2f: 'investment_entities_rel',
    board_relation_mm0999z5: 'deals_rel',
    board_relation_mm09nfxj: 'companies_rel',
    file_mm00cd6v: 'subscription_docs',
  },
  companies: {
    numeric_mm00rn7n: 'estimated_valuation_b',
    long_text_mm00wa0w: 'description',
    date4: 'date_added',
    board_relation_mm00nja3: 'deals_rel',
  },
  activities: {
    activity_owner: 'owner',
    activity_type: 'activity_type',
    activity_start_time: 'start_time',
    activity_end_time: 'end_time',
    activity_status: 'status',
    activity_item: 'related_items_rel',
  },
  investmentEntities: {
    dropdown_mm002ptq: 'entity_type',
    text_mm00258t: 'state',
    text_mm00jpep: 'country',
    text_mm0026mg: 'tax_id',
    text_mm00ef8g: 'notes',
    board_relation_mm003pdr: 'clients_rel',
  },
  spvEntities: {
    numeric_mm00kecq: 'number',
    boolean_mm00e4zk: 'has_bank_account',
    boolean_mm005nr2: 'is_active',
    date4: 'date_added',
    board_relation_mm0044tp: 'deal_rel',
  },
};

// ─── Value Parsers ──────────────────────────────────────────────────────────

function parseColumnValue(colId: string, text: string | null, value: string | null): unknown {
  if (!text && !value) return null;

  // Relations — extract linked item IDs
  if (colId.startsWith('board_relation') || colId === 'contact_deal' || colId === 'activity_item') {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return (parsed.linkedPulseIds || []).map((l: { linkedPulseId: number }) => l.linkedPulseId);
    } catch {
      return [];
    }
  }

  // Checkbox
  if (colId.startsWith('boolean')) {
    return value === 'true' || text === 'v';
  }

  // The `text` field from Monday.com is the human-readable display value
  return text || null;
}

// ─── Item Parser ────────────────────────────────────────────────────────────

interface RawColumnValue {
  id: string;
  text: string | null;
  value: string | null;
}

interface RawItem {
  id: string;
  name: string;
  group?: { title: string };
  column_values: RawColumnValue[];
  subitems?: RawItem[];
}

export function parseItem(
  boardKey: string,
  item: RawItem,
): Record<string, unknown> {
  const mapping = COLUMN_MAP[boardKey] || {};
  const result: Record<string, unknown> = {
    id: item.id,
    name: item.name,
  };

  if (item.group) {
    result.group = item.group.title;
  }

  for (const col of item.column_values) {
    const fieldName = mapping[col.id];
    if (!fieldName) continue;

    // Skip relation fields in the parsed output (they're IDs, not useful directly)
    if (fieldName.endsWith('_rel')) continue;

    result[fieldName] = parseColumnValue(col.id, col.text, col.value);
  }

  return result;
}

/**
 * Extract linked item IDs from a specific relation column.
 */
export function getRelationIds(item: RawItem, columnId: string): number[] {
  const col = item.column_values.find((c) => c.id === columnId);
  if (!col?.value) return [];
  try {
    const parsed = JSON.parse(col.value);
    return (parsed.linkedPulseIds || []).map((l: { linkedPulseId: number }) => l.linkedPulseId);
  } catch {
    return [];
  }
}

// ─── Query Helpers ──────────────────────────────────────────────────────────

const ITEMS_FIELDS = `
  id
  name
  group { title }
  column_values {
    id
    text
    value
  }
`;

/**
 * Search items on a board by name. Returns raw items.
 */
export async function searchBoard(
  boardId: string,
  query?: string,
  limit = 25,
): Promise<RawItem[]> {
  const queryParams = query
    ? `, query_params: { rules: [{ column_id: "name", compare_value: ["${query.replace(/"/g, '\\"')}"], operator: contains }] }`
    : '';

  const gql = `
    query {
      boards(ids: ["${boardId}"]) {
        items_page(limit: ${limit}${queryParams}) {
          items {
            ${ITEMS_FIELDS}
          }
        }
      }
    }
  `;

  const data = await queryMonday<{
    boards: { items_page: { items: RawItem[] } }[];
  }>(gql);

  return data.boards[0]?.items_page?.items || [];
}

/**
 * Fetch specific items by their IDs.
 */
export async function fetchItemsByIds(ids: number[]): Promise<RawItem[]> {
  if (ids.length === 0) return [];

  const gql = `
    query {
      items(ids: [${ids.join(',')}]) {
        ${ITEMS_FIELDS}
      }
    }
  `;

  const data = await queryMonday<{ items: RawItem[] }>(gql);
  return data.items || [];
}

/**
 * Fetch subitems for a parent item.
 */
export async function fetchSubitems(parentItemId: string): Promise<RawItem[]> {
  const gql = `
    query {
      items(ids: [${parentItemId}]) {
        subitems {
          ${ITEMS_FIELDS}
        }
      }
    }
  `;

  const data = await queryMonday<{ items: { subitems: RawItem[] }[] }>(gql);
  return data.items[0]?.subitems || [];
}
