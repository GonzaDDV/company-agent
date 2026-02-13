import type { ToolDefinition } from './types.js';
import type { AgentContext } from '../agent/core.js';
import {
  BOARD_IDS,
  searchBoard,
  fetchItemsByIds,
  fetchSubitems,
  parseItem,
  getRelationIds,
} from '../lib/monday.js';

export const mondayCrmToolDefs: ToolDefinition[] = [
  {
    name: 'search_crm_clients',
    description: `Search Patagon's Monday.com CRM for clients. Returns name, email, phone, location, net worth, client type, and whether they're active or prospect.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search by client name (optional — omit to list all)' },
        client_type: {
          type: 'string',
          enum: ['active', 'prospect'],
          description: 'Filter by client status group',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_crm_client_details',
    description:
      'Get full details for a specific CRM client, including their subscriptions, deals, investment entities, and interaction history.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_name: { type: 'string', description: 'Client name to look up' },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'search_crm_deals',
    description: `Search Patagon's deal pipeline. Returns deal name, size, fees, notes, and pipeline stage (Prospective, Active, Closed-to-Buyers, Closed).`,
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search by deal name (optional)' },
        status: {
          type: 'string',
          enum: ['prospective', 'active', 'closed_to_buyers', 'closed'],
          description: 'Filter by pipeline stage',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_crm_subscriptions',
    description:
      'Search CRM subscriptions (client interests in deals). Returns subscription amount, fees, document status, and interest type (buy/sell).',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search by subscription name (optional)' },
        interest_type: {
          type: 'string',
          enum: ['buy_interest', 'sell_interest', 'in_progress'],
          description: 'Filter by interest type group',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_crm_companies',
    description:
      'Search portfolio companies tracked in the CRM. Returns name, estimated valuation, and description.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search by company name (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'search_crm_activities',
    description:
      'Search CRM activities (calls, meetings). Returns activity type, owner, time, status, and related clients/deals.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search by activity name (optional)' },
        status: {
          type: 'string',
          enum: ['open', 'done'],
          description: 'Filter by activity status',
        },
        activity_type: {
          type: 'string',
          enum: ['call_summary', 'meeting'],
          description: 'Filter by activity type',
        },
      },
      required: [],
    },
  },
];

// ─── Group name mappings for filters ────────────────────────────────────────

const CLIENT_GROUPS: Record<string, string> = {
  active: 'Active Clients',
  prospect: 'Prospect Clients',
};

const DEAL_GROUPS: Record<string, string> = {
  prospective: 'Prospective Vehicles',
  active: 'Active Vehicles',
  closed_to_buyers: 'Closed-to-Buyers Vehicles',
  closed: 'Closed',
};

const SUBSCRIPTION_GROUPS: Record<string, string> = {
  buy_interest: 'Buy Interest',
  sell_interest: 'Sell Interest',
  in_progress: 'In progress / Done',
};

const ACTIVITY_STATUS: Record<string, string> = {
  open: 'Open',
  done: 'Done',
};

const ACTIVITY_TYPES: Record<string, string> = {
  call_summary: 'Call summary',
  meeting: 'Meeting',
};

// ─── Executor ───────────────────────────────────────────────────────────────

export async function executeMondayCrmTool(
  name: string,
  input: Record<string, unknown>,
  _ctx: AgentContext,
): Promise<string> {
  switch (name) {
    case 'search_crm_clients': {
      const items = await searchBoard(BOARD_IDS.clients, input.query as string | undefined);
      let results = items.map((item) => parseItem('clients', item));

      if (input.client_type) {
        const groupName = CLIENT_GROUPS[input.client_type as string];
        if (groupName) results = results.filter((r) => r.group === groupName);
      }

      if (results.length === 0) return 'No clients found.';
      return JSON.stringify(results, null, 2);
    }

    case 'get_crm_client_details': {
      const items = await searchBoard(BOARD_IDS.clients, input.client_name as string, 5);
      if (items.length === 0) return `No client found matching "${input.client_name}".`;

      const item = items[0];
      const client = parseItem('clients', item);

      // Resolve subscriptions
      const subIds = getRelationIds(item, 'board_relation_mm00b8wq');
      if (subIds.length > 0) {
        const subItems = await fetchItemsByIds(subIds);
        client.subscriptions = subItems.map((s) => parseItem('subscriptions', s));
      }

      // Resolve deals
      const dealIds = getRelationIds(item, 'contact_deal');
      if (dealIds.length > 0) {
        const dealItems = await fetchItemsByIds(dealIds);
        client.deals = dealItems.map((d) => parseItem('deals', d));
      }

      // Resolve investment entities
      const entityIds = getRelationIds(item, 'board_relation_mm00j0a2');
      if (entityIds.length > 0) {
        const entityItems = await fetchItemsByIds(entityIds);
        client.investment_entities = entityItems.map((e) => parseItem('investmentEntities', e));
      }

      // Fetch interaction logs (subitems)
      const subitems = await fetchSubitems(item.id);
      if (subitems.length > 0) {
        client.interactions = subitems.map((s) => parseItem('clientSubitems', s));
      }

      return JSON.stringify(client, null, 2);
    }

    case 'search_crm_deals': {
      const items = await searchBoard(BOARD_IDS.deals, input.query as string | undefined);
      let results = items.map((item) => parseItem('deals', item));

      if (input.status) {
        const groupName = DEAL_GROUPS[input.status as string];
        if (groupName) results = results.filter((r) => r.group === groupName);
      }

      if (results.length === 0) return 'No deals found.';
      return JSON.stringify(results, null, 2);
    }

    case 'search_crm_subscriptions': {
      const items = await searchBoard(BOARD_IDS.subscriptions, input.query as string | undefined);
      let results = items.map((item) => parseItem('subscriptions', item));

      if (input.interest_type) {
        const groupName = SUBSCRIPTION_GROUPS[input.interest_type as string];
        if (groupName) results = results.filter((r) => r.group === groupName);
      }

      if (results.length === 0) return 'No subscriptions found.';
      return JSON.stringify(results, null, 2);
    }

    case 'search_crm_companies': {
      const items = await searchBoard(BOARD_IDS.companies, input.query as string | undefined);
      const results = items.map((item) => parseItem('companies', item));

      if (results.length === 0) return 'No companies found.';
      return JSON.stringify(results, null, 2);
    }

    case 'search_crm_activities': {
      const items = await searchBoard(BOARD_IDS.activities, input.query as string | undefined);
      let results = items.map((item) => parseItem('activities', item));

      if (input.status) {
        const statusLabel = ACTIVITY_STATUS[input.status as string];
        if (statusLabel) results = results.filter((r) => r.status === statusLabel);
      }

      if (input.activity_type) {
        const typeLabel = ACTIVITY_TYPES[input.activity_type as string];
        if (typeLabel) results = results.filter((r) => r.activity_type === typeLabel);
      }

      if (results.length === 0) return 'No activities found.';
      return JSON.stringify(results, null, 2);
    }

    default:
      return `Unknown Monday CRM tool: ${name}`;
  }
}
