/**
 * Lightweight URL title fetcher.
 * Does a quick GET and extracts the <title> tag.
 */
export async function fetchUrlTitle(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; bot)',
        Accept: 'text/html',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!res.ok) return null;

    // Read only the first ~16KB to find the <title>
    const reader = res.body?.getReader();
    if (!reader) return null;

    let html = '';
    const decoder = new TextDecoder();

    while (html.length < 16384) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });

      // Check if we have the closing </title> tag
      if (html.includes('</title>')) break;
    }

    reader.cancel().catch(() => {});

    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (match?.[1]) {
      return match[1].trim().replace(/\s+/g, ' ');
    }

    return null;
  } catch {
    return null;
  }
}

/** Check if a string is a bare URL (just a URL with no surrounding text) */
export function isBareUrl(text: string): boolean {
  const trimmed = text.trim();
  return /^https?:\/\/\S+$/i.test(trimmed);
}
