// POST /api/docs/paste
// Accepts raw text directly (no file parsing needed).
// Same chunk → embed → store pipeline as /api/docs/upload.

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { ensureSchema } from "@/lib/db";
import { embedText, chunkText } from "@/lib/embeddings";

export async function POST(req: NextRequest) {
  await ensureSchema();

  const { name, text, userId } = await req.json().catch(() => ({}));

  if (!name || !text || !userId) {
    return NextResponse.json({ error: "name, text, and userId are required" }, { status: 400 });
  }

  if (typeof text !== "string" || text.trim().length < 10) {
    return NextResponse.json({ error: "Text is too short" }, { status: 400 });
  }

  const filename = name.endsWith(".txt") ? name : `${name}.txt`;

  const docResult = await sql`
    INSERT INTO medical_docs (user_id, filename, blob_url, file_size)
    VALUES (${userId}, ${filename}, ${"pasted"}, ${text.length})
    RETURNING id
  `;
  const docId: number = docResult.rows[0].id;

  const chunks = chunkText(text.trim(), 400, 50);
  let embedded = 0;

  for (let i = 0; i < chunks.length; i++) {
    try {
      const embedding = await embedText(chunks[i]);
      const vectorStr = `[${embedding.join(",")}]`;
      await sql`
        INSERT INTO doc_chunks (doc_id, user_id, chunk_index, content, embedding)
        VALUES (${docId}, ${userId}, ${i}, ${chunks[i]}, ${vectorStr}::vector)
      `;
      embedded++;
    } catch (err) {
      console.error(`[docs/paste] failed to embed chunk ${i}:`, err);
    }
  }

  return NextResponse.json({ ok: true, docId, filename, totalChunks: chunks.length, embeddedChunks: embedded });
}
