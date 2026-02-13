import type { ToolDefinition } from './types.js';
import type { AgentContext } from '../agent/core.js';
import { agentDb } from '../db/agent-db.js';
import { storeEmbeddingAsync, semanticSearch } from '../lib/embeddings.js';

export const readingsToolDefs: ToolDefinition[] = [
  {
    name: 'store_reading',
    description:
      'Store an article, podcast, book, or video in the Nerd Fuel library. When a user sends just a URL with no context, store it with minimal metadata — do not ask for details.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Title of the reading (use URL domain if unknown)' },
        url: { type: 'string', description: 'URL if applicable' },
        summary: { type: 'string', description: 'Brief summary (optional — omit if user did not provide context)' },
        content_type: {
          type: 'string',
          enum: ['article', 'podcast', 'book', 'video', 'paper', 'thread'],
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags' },
      },
      required: ['title', 'content_type'],
    },
  },
  {
    name: 'search_readings',
    description: 'Search the Nerd Fuel library for articles, podcasts, books, videos, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search term' },
        content_type: {
          type: 'string',
          enum: ['article', 'podcast', 'book', 'video', 'paper', 'thread'],
          description: 'Filter by type',
        },
      },
      required: [],
    },
  },
  {
    name: 'update_reading',
    description: 'Update a reading in the Nerd Fuel library (title, summary, tags, etc.).',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The reading ID' },
        title: { type: 'string', description: 'Updated title' },
        summary: { type: 'string', description: 'Updated summary' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Updated tags' },
        url: { type: 'string', description: 'Updated URL' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_reading',
    description: 'Permanently delete a reading from the Nerd Fuel library.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The reading ID to delete' },
      },
      required: ['id'],
    },
  },
];

export async function executeReadingsTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
): Promise<string> {
  switch (name) {
    case 'store_reading': {
      const { data, error } = await agentDb
        .from('readings')
        .insert({
          title: input.title as string,
          url: (input.url as string) || null,
          summary: (input.summary as string) || null,
          content_type: input.content_type as string,
          tags: (input.tags as string[]) || [],
          submitted_by_name: ctx.userName,
          submitted_by_telegram_id: ctx.telegramId,
        })
        .select('id, title')
        .single();

      if (error) return `Error storing reading: ${error.message}`;

      // Fire-and-forget: generate and store embedding for semantic search
      const embeddingText = [
        input.title as string,
        (input.summary as string) || '',
        ...(input.tags ? (input.tags as string[]).map((t) => `#${t}`) : []),
        input.content_type ? `type:${input.content_type}` : '',
      ].filter(Boolean).join(' ');
      storeEmbeddingAsync('readings', data.id, embeddingText);

      return `Stored "${data.title}" in Nerd Fuel.`;
    }

    case 'search_readings': {
      // Try semantic search first when a query is provided
      if (input.query) {
        const semanticResults = await semanticSearch('readings', input.query as string);
        if (semanticResults && semanticResults.length > 0) {
          const sourceIds = semanticResults.map((r) => r.source_id);
          let query = agentDb
            .from('readings')
            .select('id, title, url, summary, content_type, tags, submitted_by_name, created_at')
            .in('id', sourceIds);

          if (input.content_type) query = query.eq('content_type', input.content_type as string);

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
        .from('readings')
        .select('id, title, url, summary, content_type, tags, submitted_by_name, created_at');

      if (input.content_type) query = query.eq('content_type', input.content_type as string);

      if (input.query) {
        const q = input.query as string;
        query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%`);
      }

      query = query.order('created_at', { ascending: false }).limit(20);

      const { data, error } = await query;
      if (error) return `Search error: ${error.message}`;
      if (!data || data.length === 0) return 'No readings found.';
      return JSON.stringify(data, null, 2);
    }

    case 'update_reading': {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.title !== undefined) updates.title = input.title;
      if (input.summary !== undefined) updates.summary = input.summary;
      if (input.tags !== undefined) updates.tags = input.tags;
      if (input.url !== undefined) updates.url = input.url;

      const { error } = await agentDb
        .from('readings')
        .update(updates)
        .eq('id', input.id as string);

      if (error) return `Error updating reading: ${error.message}`;

      // Re-embed with latest data
      const { data: reading } = await agentDb
        .from('readings')
        .select('title, summary, tags, content_type')
        .eq('id', input.id as string)
        .single();

      if (reading) {
        const embeddingText = [
          reading.title,
          reading.summary || '',
          ...(reading.tags || []).map((t: string) => `#${t}`),
          reading.content_type ? `type:${reading.content_type}` : '',
        ].filter(Boolean).join(' ');
        storeEmbeddingAsync('readings', input.id as string, embeddingText);
      }

      return 'Reading updated.';
    }

    case 'delete_reading': {
      await agentDb
        .from('embeddings')
        .delete()
        .eq('source_table', 'readings')
        .eq('source_id', input.id as string);

      const { error } = await agentDb
        .from('readings')
        .delete()
        .eq('id', input.id as string);

      if (error) return `Error deleting reading: ${error.message}`;
      return 'Reading deleted.';
    }

    default:
      return `Unknown readings tool: ${name}`;
  }
}
