import { sql } from "@vercel/postgres";

export async function ensureSchema() {
  // Enable pgvector — idempotent, safe on every cold start
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  // Original sessions table
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id           SERIAL PRIMARY KEY,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      mode         TEXT NOT NULL,
      language     TEXT NOT NULL DEFAULT 'en',
      goal         TEXT,
      goal_target  TEXT,
      goal_current TEXT,
      summary      TEXT,
      user_id      TEXT
    )
  `;
  // Backfill: add user_id if upgrading from old schema
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id TEXT`;

  // User identity (device UUID from iOS)
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      user_id       TEXT PRIMARY KEY,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      display_name  TEXT,
      bio_sex       TEXT,
      date_of_birth DATE,
      goals         TEXT[]
    )
  `;

  // HealthKit snapshots — one row per session start
  await sql`
    CREATE TABLE IF NOT EXISTS health_snapshots (
      id             SERIAL PRIMARY KEY,
      user_id        TEXT NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      hrv            FLOAT,
      resting_hr     FLOAT,
      sleep_hours    FLOAT,
      sleep_quality  FLOAT,
      steps          INTEGER,
      active_energy  FLOAT,
      recovery_score FLOAT,
      health_state   TEXT
    )
  `;

  // Brain config — single admin-editable row (id = 1)
  await sql`
    CREATE TABLE IF NOT EXISTS brain_config (
      id              INTEGER PRIMARY KEY DEFAULT 1,
      persona_prompt  TEXT NOT NULL,
      knowledge_rules TEXT NOT NULL,
      response_style  TEXT NOT NULL,
      safety_rules    TEXT NOT NULL,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Medical document metadata
  await sql`
    CREATE TABLE IF NOT EXISTS medical_docs (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL,
      filename   TEXT NOT NULL,
      blob_url   TEXT NOT NULL,
      file_size  INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Document chunks + 1536-dim vector embeddings (OpenAI text-embedding-3-small)
  await sql`
    CREATE TABLE IF NOT EXISTS doc_chunks (
      id          SERIAL PRIMARY KEY,
      doc_id      INTEGER NOT NULL REFERENCES medical_docs(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content     TEXT NOT NULL,
      embedding   vector(1536)
    )
  `;

  // IVFFlat approximate nearest-neighbour index for cosine similarity search
  await sql`
    CREATE INDEX IF NOT EXISTS doc_chunks_embedding_idx
    ON doc_chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
  `;

  // API keys + model preferences — single admin row (id = 1)
  await sql`
    CREATE TABLE IF NOT EXISTS brain_secrets (
      id              INTEGER PRIMARY KEY DEFAULT 1,
      openai_key      TEXT,
      anthropic_key   TEXT,
      primary_model   TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
      rag_threshold   FLOAT NOT NULL DEFAULT 0.25,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Avatar platform keys — single admin row (id = 1)
  await sql`
    CREATE TABLE IF NOT EXISTS avatar_secrets (
      id             INTEGER PRIMARY KEY DEFAULT 1,
      hedra_key      TEXT,
      hedra_secret   TEXT,
      stability_key  TEXT,
      fal_key        TEXT,
      elevenlabs_key TEXT,
      livekit_key    TEXT,
      livekit_secret TEXT,
      livekit_url    TEXT,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function logSession(data: {
  mode: string;
  language: string;
  goal?: string;
  goalTarget?: string;
  goalCurrent?: string;
  summary?: string;
  userId?: string;
}) {
  await ensureSchema();
  await sql`
    INSERT INTO sessions (mode, language, goal, goal_target, goal_current, summary, user_id)
    VALUES (
      ${data.mode},
      ${data.language},
      ${data.goal ?? null},
      ${data.goalTarget ?? null},
      ${data.goalCurrent ?? null},
      ${data.summary ?? null},
      ${data.userId ?? null}
    )
  `;
}
