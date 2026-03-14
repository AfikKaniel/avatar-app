import { sql } from "@vercel/postgres";

export async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id          SERIAL PRIMARY KEY,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      mode        TEXT NOT NULL,
      language    TEXT NOT NULL DEFAULT 'en',
      goal        TEXT,
      goal_target TEXT,
      goal_current TEXT,
      summary     TEXT
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
}) {
  await ensureSchema();
  await sql`
    INSERT INTO sessions (mode, language, goal, goal_target, goal_current, summary)
    VALUES (
      ${data.mode},
      ${data.language},
      ${data.goal ?? null},
      ${data.goalTarget ?? null},
      ${data.goalCurrent ?? null},
      ${data.summary ?? null}
    )
  `;
}
