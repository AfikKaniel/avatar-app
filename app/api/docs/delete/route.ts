// DELETE /api/docs/delete?docId=<id>&userId=<id>
// Deletes the doc metadata + all chunks (via ON DELETE CASCADE) + Vercel Blob file.

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { del } from "@vercel/blob";
import { ensureSchema } from "@/lib/db";

export async function DELETE(req: NextRequest) {
  await ensureSchema();

  const docId = req.nextUrl.searchParams.get("docId");
  const userId = req.nextUrl.searchParams.get("userId");

  if (!docId || !userId) {
    return NextResponse.json({ error: "docId and userId are required" }, { status: 400 });
  }

  // Fetch blob URL before deleting (needed to remove from Blob storage)
  const docResult = await sql`
    SELECT blob_url FROM medical_docs
    WHERE id = ${docId} AND user_id = ${userId}
  `;

  if (!docResult.rows.length) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const blobUrl: string = docResult.rows[0].blob_url;

  // Delete from Postgres (doc_chunks cascade automatically)
  await sql`DELETE FROM medical_docs WHERE id = ${docId} AND user_id = ${userId}`;

  // Delete from Vercel Blob storage
  try {
    await del(blobUrl);
  } catch (err) {
    // Non-fatal — DB row is already gone, blob cleanup failure is acceptable
    console.warn("[docs/delete] blob deletion failed:", err);
  }

  return NextResponse.json({ ok: true });
}
