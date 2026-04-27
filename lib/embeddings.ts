// lib/embeddings.ts
// OpenAI text-embedding-3-small (1536 dims) + pgvector similarity search + text chunker

import { sql } from "@vercel/postgres";

const EMBED_MODEL = "text-embedding-3-small";

// ── Embedding ──────────────────────────────────────────────────────────────────

export async function embedText(text: string): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    // Truncate to ~8k chars — model max is 8192 tokens
    body: JSON.stringify({ input: text.slice(0, 8000), model: EMBED_MODEL }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Embedding API error ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return data.data[0].embedding as number[];
}

// ── Global knowledge base ─────────────────────────────────────────────────────
// Docs uploaded via the web admin use this ID so they apply to all users.

export const GLOBAL_USER_ID = "gaging-global";

// ── Similarity search ─────────────────────────────────────────────────────────
// Searches both the user's personal docs AND the global knowledge base,
// de-duplicates, and returns the topK most relevant chunks.

export async function searchRelevantChunks(
  userId: string,
  query: string,
  topK = 4
): Promise<{ content: string; similarity: number }[]> {
  const embedding = await embedText(query);
  const vectorStr = `[${embedding.join(",")}]`;

  const rows = await sql`
    SELECT content,
           1 - (embedding <=> ${vectorStr}::vector) AS similarity
    FROM   doc_chunks
    WHERE  user_id = ${userId} OR user_id = ${GLOBAL_USER_ID}
    ORDER  BY embedding <=> ${vectorStr}::vector
    LIMIT  ${topK}
  `;
  return rows.rows as { content: string; similarity: number }[];
}

// ── Text chunker ──────────────────────────────────────────────────────────────
// Splits on word boundaries. chunk_size ≈ 400 words (~500 tokens), overlap = 50 words.

export function chunkText(
  text: string,
  chunkSize = 400,
  overlap = 50
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
    start += chunkSize - overlap;
  }

  return chunks;
}
