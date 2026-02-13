import OpenAI from 'openai';
import { env } from '../config/env.js';
import { agentDb } from '../db/agent-db.js';

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: env.OPENROUTER_API_KEY,
});

/**
 * Generate a one-line summary of text using a fast model.
 */
async function generateSummary(text: string): Promise<string | null> {
  try {
    const response = await openrouter.chat.completions.create({
      model: 'openrouter/auto',
      max_tokens: 100,
      messages: [
        {
          role: 'system',
          content: 'Summarize the following in one short sentence (max 15 words). No preamble, just the summary.',
        },
        { role: 'user', content: text },
      ],
    });
    return response.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[summarize] Failed to generate summary:', err);
    return null;
  }
}

/**
 * Generate and store a one-line summary for a note. Fire-and-forget.
 */
export function summarizeNoteAsync(noteId: string, content: string): void {
  generateSummary(content)
    .then(async (summary) => {
      if (!summary) return;
      const { error } = await agentDb
        .from('notes')
        .update({ summary })
        .eq('id', noteId);
      if (error) console.error(`[summarize] Failed to store summary for ${noteId}:`, error.message);
    })
    .catch((err) => {
      console.error(`[summarize] Async summary failed for ${noteId}:`, err);
    });
}

/**
 * Backfill summaries for all notes that don't have one yet.
 */
export async function backfillSummaries(): Promise<void> {
  const { data, error } = await agentDb
    .from('notes')
    .select('id, content')
    .is('summary', null);

  if (error) {
    console.error('[summarize] Backfill query failed:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('[summarize] No notes need backfilling.');
    return;
  }

  console.log(`[summarize] Backfilling ${data.length} notes...`);
  for (const note of data) {
    const summary = await generateSummary(note.content);
    if (summary) {
      await agentDb.from('notes').update({ summary }).eq('id', note.id);
      console.log(`[summarize] Backfilled: ${summary}`);
    }
  }
  console.log('[summarize] Backfill complete.');
}
