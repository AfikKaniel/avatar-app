// GET /api/docs/list?userId=<id>
// Returns all medical documents for a user, with their embedded chunk counts.

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { ensureSchema } from "@/lib/db";

export async function GET(req: NextRequest) {
  await ensureSchema();

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const result = await sql`
    SELECT
      d.id,
      d.filename,
      d.blob_url,
      d.file_size,
      d.created_at,
      COUNT(c.id)::int AS chunk_count
    FROM   medical_docs d
    LEFT JOIN doc_chunks c ON c.doc_id = d.id
    WHERE  d.user_id = ${userId}
    GROUP  BY d.id
    ORDER  BY d.created_at DESC
  `;

  const docs = result.rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    blobUrl: r.blob_url,
    fileSize: r.file_size,
    chunkCount: r.chunk_count,
    createdAt: r.created_at,
  }));

  return NextResponse.json({ docs });
}
