// POST /api/docs/upload
// Accepts PDF, DOCX, DOC, RTF, TXT, MD + userId.
// Key fix: buffer is read ONCE before anything else runs, eliminating any
// stream-consumption issues. Format is detected by magic bytes, not extension.

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { put } from "@vercel/blob";
import { ensureSchema } from "@/lib/db";
import { embedText, chunkText } from "@/lib/embeddings";

// ── Format detection by magic bytes ───────────────────────────────────────────

function detectFormat(buf: Buffer): "zip" | "pdf" | "ole" | "rtf" | "html" | "text" | "unknown" {
  if (buf.length < 8) return "unknown";
  const h = buf.slice(0, 8).toString("hex");
  if (h.startsWith("504b")) return "zip";                      // ZIP (DOCX/ODT/…)
  if (buf.slice(0, 4).toString("ascii") === "%PDF") return "pdf";
  if (h === "d0cf11e0a1b11ae1") return "ole";                  // old binary .doc
  if (buf.slice(0, 5).toString("ascii") === "{\\rtf") return "rtf";
  const head = buf.slice(0, 200).toString("utf-8").toLowerCase();
  if (head.includes("<html") || head.startsWith("<!doctype")) return "html";
  return "text";
}

// ── Extractors ─────────────────────────────────────────────────────────────────

async function extractZipDocx(buf: Buffer): Promise<string> {
  const JSZipMod = await import("jszip");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const JSZip = (JSZipMod as any).default ?? JSZipMod;
  const zip = await JSZip.loadAsync(buf);

  // Standard DOCX
  const docXml = zip.file("word/document.xml");
  if (docXml) {
    const xml: string = await docXml.async("text");
    return xml
      .replace(/<w:p[ >][^>]*>/g, "\n")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\n{3,}/g, "\n\n").trim();
  }

  // ODT (OpenDocument)
  const odtXml = zip.file("content.xml");
  if (odtXml) {
    const xml: string = await odtXml.async("text");
    return xml.replace(/<text:p[^>]*>/g, "\n").replace(/<[^>]+>/g, "").trim();
  }

  throw new Error("ZIP file does not contain a recognisable document structure (tried DOCX, ODT)");
}

async function extractPdf(buf: Buffer): Promise<string> {
  // Belt-and-suspenders: ensure polyfill exists before pdfjs-dist initialises
  const g = globalThis as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!g.DOMMatrix) g.DOMMatrix = class { transformPoint(p: any) { return { x: p?.x??0, y: p?.y??0, z: 0, w: 1 }; } multiply(){ return this; } translate(){ return this; } scale(){ return this; } inverse(){ return this; } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!g.DOMPoint)  g.DOMPoint  = class { x=0;y=0;z=0;w=1; } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!g.Path2D)    g.Path2D    = class {} as any;

  const mod = await import("pdf-parse");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse: (b: Buffer, o?: object) => Promise<{ text: string }> = (mod as any).default ?? mod;
  const result = await pdfParse(buf, { max: 0 });
  if (!result.text.trim()) throw new Error("PDF has no extractable text (may be scanned image)");
  return result.text;
}

function extractOle(buf: Buffer): string {
  // Heuristic UTF-16LE scan — captures most prose from binary .doc files
  const runs: string[] = [];
  let i = 0;
  while (i < buf.length - 1) {
    if (buf[i + 1] === 0 && buf[i] >= 0x20 && buf[i] <= 0x7e) {
      let run = "";
      while (i < buf.length - 1 && buf[i + 1] === 0 && buf[i] >= 0x20 && buf[i] <= 0x7e) {
        run += String.fromCharCode(buf[i]);
        i += 2;
      }
      if (run.trim().length >= 4) runs.push(run.trim());
    } else { i++; }
  }
  const text = runs.join(" ").replace(/\s{2,}/g, " ").trim();
  if (text.length < 50) throw new Error("Could not extract readable text from binary .doc file");
  return text;
}

function extractRtf(buf: Buffer): string {
  const rtf = buf.toString("latin1");
  return rtf
    .replace(/\{\\[^{}]*\}/g, " ")   // remove embedded objects
    .replace(/\\[a-z]+[-]?\d*\s?/g, " ") // control words
    .replace(/[{}\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPlain(buf: Buffer): string {
  // Try UTF-8 first, fall back to latin1
  try {
    const t = buf.toString("utf-8");
    const printable = (t.match(/[\x20-\x7E\n\r\tÀ-￿]/g) || []).length;
    if (printable / t.length > 0.6) return t.trim();
  } catch { /* ignore */ }
  return buf.toString("latin1").replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{3,}/g, "\n").trim();
}

// ── Main extractor (magic-byte-first) ─────────────────────────────────────────

async function extractText(buf: Buffer, filename: string): Promise<string> {
  const fmt = detectFormat(buf);
  console.log(`[docs/upload] ${filename}: detected format=${fmt}, size=${buf.length}`);

  if (fmt === "zip")  return extractZipDocx(buf);
  if (fmt === "pdf")  return extractPdf(buf);
  if (fmt === "ole")  return extractOle(buf);
  if (fmt === "rtf")  return extractRtf(buf);
  if (fmt === "html") return buf.toString("utf-8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (fmt === "text") return extractPlain(buf);

  // Unknown — best-effort plain text scan
  const fallback = extractPlain(buf);
  if (fallback.length > 100) return fallback;

  const hex = buf.slice(0, 8).toString("hex");
  throw new Error(`Unrecognised file format (magic bytes: ${hex}). Try saving as .txt or .docx from Word.`);
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  await ensureSchema();

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const userId = formData.get("userId") as string | null;

  if (!file || !userId) {
    return NextResponse.json({ error: "file and userId are required" }, { status: 400 });
  }

  // ── Read buffer FIRST — before any other operation ────────────────────────
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    return NextResponse.json({ error: "Received an empty file" }, { status: 400 });
  }

  // ── Validate extension ─────────────────────────────────────────────────────
  const name = file.name.toLowerCase();
  const allowed = [".pdf", ".docx", ".doc", ".rtf", ".txt", ".md", ".html", ".htm"];
  if (!allowed.some(ext => name.endsWith(ext))) {
    return NextResponse.json(
      { error: `Unsupported extension. Allowed: ${allowed.join(", ")}` },
      { status: 415 }
    );
  }

  // ── Store in Vercel Blob ───────────────────────────────────────────────────
  const blob = await put(
    `medical-docs/${userId}/${Date.now()}-${file.name}`,
    new Blob([buffer], { type: file.type }),
    { access: "public" }
  );

  // ── Extract text ──────────────────────────────────────────────────────────
  let text: string;
  try {
    text = await extractText(buffer, file.name);
  } catch (err) {
    console.error("[docs/upload] extraction failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 422 });
  }

  if (!text.trim()) {
    return NextResponse.json({ error: "File appears to be empty or unreadable" }, { status: 422 });
  }

  // ── Insert doc row ─────────────────────────────────────────────────────────
  const docResult = await sql`
    INSERT INTO medical_docs (user_id, filename, blob_url, file_size)
    VALUES (${userId}, ${file.name}, ${blob.url}, ${file.size})
    RETURNING id
  `;
  const docId: number = docResult.rows[0].id;

  // ── Chunk → embed → store ─────────────────────────────────────────────────
  const chunks = chunkText(text, 400, 50);
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
      console.error(`[docs/upload] failed to embed chunk ${i}:`, err);
    }
  }

  return NextResponse.json({
    ok: true, docId, filename: file.name,
    format: detectFormat(buffer),
    totalChunks: chunks.length, embeddedChunks: embedded,
  });
}
