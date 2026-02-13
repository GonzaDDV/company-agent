import type Anthropic from '@anthropic-ai/sdk';
import type { AgentContext } from '../agent/core.js';
import { agentDb } from '../db/agent-db.js';

export const knowledgeToolDefs: Anthropic.Tool[] = [
  {
    name: 'store_note',
    description: `Store a note, idea, task, or any piece of information for the team.
Types: "note" (general), "task" (actionable), "idea" (explore later), "logistics" (travel, schedules, whereabouts), "legal" (lawyer-related)`,
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'The note content' },
        type: {
          type: 'string',
          enum: ['note', 'task', 'idea', 'logistics', 'legal'],
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        company: {
          type: 'string',
          enum: ['thc', 'patagon'],
          description: 'Which company this relates to (omit if shared)',
        },
      },
      required: ['content', 'type'],
    },
  },
  {
    name: 'search_notes',
    description:
      'Search stored notes, ideas, tasks, and knowledge. Returns matching items ordered by most recent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search term (searches in content)' },
        type: {
          type: 'string',
          enum: ['note', 'task', 'idea', 'logistics', 'legal'],
          description: 'Filter by type',
        },
        company: { type: 'string', enum: ['thc', 'patagon'], description: 'Filter by company' },
        status: {
          type: 'string',
          enum: ['open', 'done', 'archived'],
          description: 'Filter by status',
        },
      },
      required: [],
    },
  },
  {
    name: 'update_note',
    description: "Update a note's status (e.g., mark a task as done) or content.",
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The note ID' },
        status: { type: 'string', enum: ['open', 'done', 'archived'] },
        content: { type: 'string', description: 'Updated content' },
      },
      required: ['id'],
    },
  },
];

export async function executeKnowledgeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
): Promise<string> {
  switch (name) {
    case 'store_note': {
      const { data, error } = await agentDb
        .from('notes')
        .insert({
          content: input.content as string,
          type: input.type as string,
          tags: (input.tags as string[]) || [],
          company: (input.company as string) || null,
          author_name: ctx.userName,
          author_telegram_id: ctx.telegramId,
        })
        .select('id, type')
        .single();

      if (error) return `Error storing note: ${error.message}`;
      return `Stored ${data.type} with ID: ${data.id}`;
    }

    case 'search_notes': {
      let query = agentDb
        .from('notes')
        .select('id, content, type, tags, company, status, author_name, created_at');

      if (input.type) query = query.eq('type', input.type as string);
      if (input.company) query = query.eq('company', input.company as string);
      if (input.status) query = query.eq('status', input.status as string);
      if (input.query) query = query.ilike('content', `%${input.query as string}%`);

      query = query.order('created_at', { ascending: false }).limit(20);

      const { data, error } = await query;
      if (error) return `Search error: ${error.message}`;
      if (!data || data.length === 0) return 'No notes found.';
      return JSON.stringify(data, null, 2);
    }

    case 'update_note': {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.status) updates.status = input.status;
      if (input.content) updates.content = input.content;

      const { error } = await agentDb
        .from('notes')
        .update(updates)
        .eq('id', input.id as string);

      if (error) return `Error updating note: ${error.message}`;
      return `Note updated.`;
    }

    default:
      return `Unknown knowledge tool: ${name}`;
  }
}
