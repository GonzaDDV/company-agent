import OpenAI from 'openai';
import { env } from '../config/env.js';
import { agentDb } from '../db/agent-db.js';

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: env.OPENROUTER_API_KEY,
});

/**
 * Generate an embedding vector for the given text.
 * Returns null on error.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const response = await openrouter.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data[0].embedding;
}

/**
 * Store an embedding for a source record.
 * Uses upsert so re-embedding the same record replaces the old vector.
 */
export async function storeEmbedding(
  sourceTable: string,
  sourceId: string,
  contentText: string,
): Promise<void> {
  const embedding = await generateEmbedding(contentText);
  if (!embedding) return;

  // Format as pgvector string: [0.1,0.2,...]
  const vectorStr = `[${embedding.join(',')}]`;

  const { error } = await agentDb
    .from('embeddings')
    .upsert(
      {
        source_table: sourceTable,
        source_id: sourceId,
        content_text: contentText,
        embedding: vectorStr,
      },
      { onConflict: 'source_table,source_id' },
    );

  if (error) {
    console.error(`[embeddings] Failed to store embedding for ${sourceTable}/${sourceId}:`, error.message);
  }
}

/**
 * Fire-and-forget: generate and store an embedding without blocking the caller.
 * Logs errors to console but never throws.
 */
export function storeEmbeddingAsync(
  sourceTable: string,
  sourceId: string,
  contentText: string,
): void {
  storeEmbedding(sourceTable, sourceId, contentText).catch((err) => {
    console.error(`[embeddings] Async embedding failed for ${sourceTable}/${sourceId}:`, err);
  });
}

/**
 * Semantic search: find source IDs matching a query, ordered by similarity.
 * Returns an array of { source_id, similarity } or null if embeddings are unavailable.
 */
export async function semanticSearch(
  sourceTable: string,
  query: string,
  options: { threshold?: number; limit?: number } = {},
): Promise<{ source_id: string; content_text: string; similarity: number }[] | null> {
  const embedding = await generateEmbedding(query);
  if (!embedding) return null;

  const vectorStr = `[${embedding.join(',')}]`;

  const { data, error } = await agentDb.rpc('match_embeddings', {
    query_embedding: vectorStr,
    match_source_table: sourceTable,
    match_threshold: options.threshold ?? 0.3,
    match_count: options.limit ?? 20,
  });

  if (error) {
    console.error(`[embeddings] Semantic search failed for ${sourceTable}:`, error.message);
    return null;
  }

  return data as { source_id: string; content_text: string; similarity: number }[];
}
