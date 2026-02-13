import type Anthropic from '@anthropic-ai/sdk';
import type { AgentContext } from '../agent/core.js';
import { agentDb } from '../db/agent-db.js';

export const readingsToolDefs: Anthropic.Tool[] = [
  {
    name: 'store_reading',
    description:
      'Store an article, podcast, book, or video in the Nerd Fuel library. Include a summary of why it is interesting.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Title of the reading' },
        url: { type: 'string', description: 'URL if applicable' },
        summary: { type: 'string', description: "Brief summary or why it's interesting" },
        content_type: {
          type: 'string',
          enum: ['article', 'podcast', 'book', 'video', 'paper', 'thread'],
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags' },
      },
      required: ['title', 'summary', 'content_type'],
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
      return `Stored "${data.title}" in Nerd Fuel (ID: ${data.id})`;
    }

    case 'search_readings': {
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

    default:
      return `Unknown readings tool: ${name}`;
  }
}
