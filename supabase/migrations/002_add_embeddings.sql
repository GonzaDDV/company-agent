-- Enable pgvector extension (must be enabled on Supabase dashboard or via migration)
CREATE EXTENSION IF NOT EXISTS vector;

-- Embeddings table: stores vector embeddings for any source table row
CREATE TABLE embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,  -- 'notes', 'readings', 'people'
  source_id uuid NOT NULL,
  content_text text NOT NULL,  -- The text that was embedded (for debugging/display)
  embedding vector(1536) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Index for fast vector similarity search (ivfflat for good balance of speed/accuracy)
-- Using cosine distance since OpenAI embeddings are normalized
CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Index for filtering by source table
CREATE INDEX idx_embeddings_source ON embeddings (source_table, source_id);

-- Unique constraint: one embedding per source row (upsert-friendly)
CREATE UNIQUE INDEX idx_embeddings_source_unique ON embeddings (source_table, source_id);

-- Similarity search function
-- Returns source IDs ordered by cosine similarity to the query embedding
CREATE OR REPLACE FUNCTION match_embeddings(
  query_embedding vector(1536),
  match_source_table text,
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 20
)
RETURNS TABLE (
  source_id uuid,
  content_text text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    e.source_id,
    e.content_text,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM embeddings e
  WHERE e.source_table = match_source_table
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;
