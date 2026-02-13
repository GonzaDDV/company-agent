import type { ToolDefinition } from './types.js';
import type { AgentContext } from '../agent/core.js';
import { agentDb } from '../db/agent-db.js';
import { storeEmbeddingAsync, semanticSearch } from '../lib/embeddings.js';

export const transcriptsToolDefs: ToolDefinition[] = [
  {
    name: 'store_transcript',
    description:
      'Store a meeting transcript or meeting notes. Include participants and date if known.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'The transcript text' },
        summary: { type: 'string', description: 'Brief summary of the meeting' },
        participants: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of people in the meeting',
        },
        meeting_date: {
          type: 'string',
          description: 'ISO date of the meeting (e.g. 2025-01-15)',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'search_transcripts',
    description: 'Search meeting transcripts and notes by keyword or topic.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search term' },
      },
      required: ['query'],
    },
  },
  {
    name: 'update_transcript',
    description: 'Update a meeting transcript (content, summary, participants).',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The transcript ID' },
        content: { type: 'string', description: 'Updated transcript text' },
        summary: { type: 'string', description: 'Updated summary' },
        participants: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated participant names',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_transcript',
    description: 'Permanently delete a meeting transcript.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The transcript ID to delete' },
      },
      required: ['id'],
    },
  },
];

export async function executeTranscriptsTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
): Promise<string> {
  switch (name) {
    case 'store_transcript': {
      const { data, error } = await agentDb
        .from('transcripts')
        .insert({
          content: input.content as string,
          summary: (input.summary as string) || null,
          participants: (input.participants as string[]) || [],
          meeting_date: (input.meeting_date as string) || null,
          source: 'manual',
          author_telegram_id: ctx.telegramId,
        })
        .select('id')
        .single();

      if (error) return `Error storing transcript: ${error.message}`;

      // Fire-and-forget: generate and store embedding for semantic search
      const embeddingText = [
        input.content as string,
        input.summary ? `Summary: ${input.summary}` : '',
        ...(input.participants
          ? (input.participants as string[]).map((p) => `participant:${p}`)
          : []),
      ]
        .filter(Boolean)
        .join(' ');
      storeEmbeddingAsync('transcripts', data.id, embeddingText);

      return `Stored transcript.`;
    }

    case 'search_transcripts': {
      // Try semantic search first
      const semanticResults = await semanticSearch('transcripts', input.query as string);
      if (semanticResults && semanticResults.length > 0) {
        const sourceIds = semanticResults.map((r) => r.source_id);
        const { data, error } = await agentDb
          .from('transcripts')
          .select('id, content, summary, participants, meeting_date, source, created_at')
          .in('id', sourceIds)
          .limit(10);

        if (!error && data && data.length > 0) {
          // Re-sort by similarity order from semantic search
          const idOrder = new Map(sourceIds.map((id, i) => [id, i]));
          data.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));
          return JSON.stringify(data, null, 2);
        }
      }

      // Fallback: ilike keyword search on content
      const { data, error } = await agentDb
        .from('transcripts')
        .select('id, content, summary, participants, meeting_date, source, created_at')
        .ilike('content', `%${input.query as string}%`)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) return `Search error: ${error.message}`;
      if (!data || data.length === 0) return 'No transcripts found.';
      return JSON.stringify(data, null, 2);
    }

    case 'update_transcript': {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.content !== undefined) updates.content = input.content;
      if (input.summary !== undefined) updates.summary = input.summary;
      if (input.participants !== undefined) updates.participants = input.participants;

      const { error } = await agentDb
        .from('transcripts')
        .update(updates)
        .eq('id', input.id as string);

      if (error) return `Error updating transcript: ${error.message}`;

      // Re-embed with latest data
      const { data: transcript } = await agentDb
        .from('transcripts')
        .select('content, summary, participants')
        .eq('id', input.id as string)
        .single();

      if (transcript) {
        const embeddingText = [
          transcript.content,
          transcript.summary ? `Summary: ${transcript.summary}` : '',
          ...(transcript.participants || []).map((p: string) => `participant:${p}`),
        ].filter(Boolean).join(' ');
        storeEmbeddingAsync('transcripts', input.id as string, embeddingText);
      }

      return 'Transcript updated.';
    }

    case 'delete_transcript': {
      await agentDb
        .from('embeddings')
        .delete()
        .eq('source_table', 'transcripts')
        .eq('source_id', input.id as string);

      const { error } = await agentDb
        .from('transcripts')
        .delete()
        .eq('id', input.id as string);

      if (error) return `Error deleting transcript: ${error.message}`;
      return 'Transcript deleted.';
    }

    default:
      return `Unknown transcripts tool: ${name}`;
  }
}
