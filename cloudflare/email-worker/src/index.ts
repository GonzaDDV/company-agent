import PostalMime from 'postal-mime';

interface Env {
  AGENT_SUPABASE_URL: string;
  AGENT_SUPABASE_SERVICE_ROLE_KEY: string;
  OPENROUTER_API_KEY: string;
}

/**
 * Strip HTML tags and decode common entities to get plain text.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Store a transcript in Supabase via the REST API.
 * Returns the created transcript record (with id).
 */
async function storeTranscript(
  env: Env,
  content: string,
  summary: string,
  participants: string,
): Promise<{ id: string }> {
  const response = await fetch(`${env.AGENT_SUPABASE_URL}/rest/v1/transcripts`, {
    method: 'POST',
    headers: {
      apikey: env.AGENT_SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.AGENT_SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      content,
      summary,
      participants,
      meeting_date: new Date().toISOString(),
      source: 'email',
      author_telegram_id: null,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase transcripts insert failed (${response.status}): ${errorText}`);
  }

  const rows = (await response.json()) as { id: string }[];
  return rows[0];
}

/**
 * Generate an embedding via OpenRouter and store it in the embeddings table.
 * This is best-effort: errors are logged but do not fail the overall flow.
 */
async function generateAndStoreEmbedding(
  env: Env,
  sourceId: string,
  contentText: string,
): Promise<void> {
  const truncated = contentText.slice(0, 8000);

  // Generate embedding via OpenRouter
  const embeddingResponse = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/text-embedding-3-small',
      input: truncated,
      dimensions: 1536,
    }),
  });

  if (!embeddingResponse.ok) {
    const errorText = await embeddingResponse.text();
    console.error(`OpenRouter embedding request failed (${embeddingResponse.status}): ${errorText}`);
    return;
  }

  const embeddingData = (await embeddingResponse.json()) as {
    data: { embedding: number[] }[];
  };
  const embedding = embeddingData.data[0].embedding;
  const embeddingStr = `[${embedding.join(',')}]`;

  // Store embedding in Supabase
  const storeResponse = await fetch(`${env.AGENT_SUPABASE_URL}/rest/v1/embeddings`, {
    method: 'POST',
    headers: {
      apikey: env.AGENT_SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.AGENT_SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      source_table: 'transcripts',
      source_id: sourceId,
      content_text: truncated,
      embedding: embeddingStr,
    }),
  });

  if (!storeResponse.ok) {
    const errorText = await storeResponse.text();
    console.error(`Supabase embeddings upsert failed (${storeResponse.status}): ${errorText}`);
    return;
  }

  console.log(`Embedding stored for transcript ${sourceId}`);
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    const from = message.from;
    const subject = message.headers.get('subject') || '(no subject)';

    console.log(`Received email from ${from}, subject: ${subject}`);

    // Read the raw email bytes and parse with postal-mime
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parser = new PostalMime();
    const parsed = await parser.parse(rawEmail);

    // Extract plain text body: prefer text, fall back to stripping HTML
    let body = parsed.text || '';
    if (!body && parsed.html) {
      body = htmlToPlainText(parsed.html);
    }

    // Extract participant from the "from" field
    const participants = parsed.from
      ? parsed.from.name
        ? `${parsed.from.name} <${parsed.from.address}>`
        : parsed.from.address || from
      : from;

    // Store the transcript in Supabase
    const transcript = await storeTranscript(env, body, subject, participants);
    console.log(`Transcript stored with id: ${transcript.id}`);

    // Generate embedding (best-effort, non-blocking for error handling)
    try {
      await generateAndStoreEmbedding(env, transcript.id, body);
    } catch (err) {
      console.error('Failed to generate/store embedding:', err);
    }
  },
} satisfies ExportedHandler<Env>;
