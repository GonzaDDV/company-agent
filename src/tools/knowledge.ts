import type { ToolDefinition } from './types.js';
import type { AgentContext } from '../agent/core.js';
import { agentDb } from '../db/agent-db.js';
import { storeEmbeddingAsync, semanticSearch } from '../lib/embeddings.js';
import { summarizeNoteAsync } from '../lib/summarize.js';

export const knowledgeToolDefs: ToolDefinition[] = [
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
  {
    name: 'delete_note',
    description: 'Permanently delete a note, task, idea, or other knowledge item.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The note ID to delete' },
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

      // Fire-and-forget: generate and store embedding for semantic search
      const embeddingText = [
        input.content as string,
        ...(input.tags ? (input.tags as string[]).map((t) => `#${t}`) : []),
        input.type ? `type:${input.type}` : '',
        input.company ? `company:${input.company}` : '',
      ].filter(Boolean).join(' ');
      storeEmbeddingAsync('notes', data.id, embeddingText);
      summarizeNoteAsync(data.id, input.content as string);

      return `Stored ${data.type}.`;
    }

    case 'search_notes': {
      // Try semantic search first when a query is provided
      if (input.query) {
        const semanticResults = await semanticSearch('notes', input.query as string);
        if (semanticResults && semanticResults.length > 0) {
          const sourceIds = semanticResults.map((r) => r.source_id);
          let query = agentDb
            .from('notes')
            .select('id, content, type, tags, company, status, author_name, created_at')
            .in('id', sourceIds);

          if (input.type) query = query.eq('type', input.type as string);
          if (input.company) query = query.eq('company', input.company as string);
          if (input.status) query = query.eq('status', input.status as string);

          const { data, error } = await query;
          if (!error && data && data.length > 0) {
            // Re-sort by similarity order from semantic search
            const idOrder = new Map(sourceIds.map((id, i) => [id, i]));
            data.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));
            return JSON.stringify(data, null, 2);
          }
        }
      }

      // Fallback: ilike keyword search
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

      // Re-embed and re-summarize if content was updated
      if (input.content) {
        storeEmbeddingAsync('notes', input.id as string, input.content as string);
        summarizeNoteAsync(input.id as string, input.content as string);
      }

      return `Note updated.`;
    }

    case 'delete_note': {
      // Delete embedding first (no cascade FK)
      await agentDb
        .from('embeddings')
        .delete()
        .eq('source_table', 'notes')
        .eq('source_id', input.id as string);

      const { error } = await agentDb
        .from('notes')
        .delete()
        .eq('id', input.id as string);

      if (error) return `Error deleting note: ${error.message}`;
      return 'Note deleted.';
    }

    default:
      return `Unknown knowledge tool: ${name}`;
  }
}
