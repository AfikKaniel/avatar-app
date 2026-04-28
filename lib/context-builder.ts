// lib/context-builder.ts
// Assembles the full Claude system prompt from brain config + health data + session memory + RAG

import { sql } from "@vercel/postgres";
import { searchRelevantChunks } from "./embeddings";
import { ensureSchema } from "./db";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BrainConfig {
  personaPrompt: string;
  knowledgeRules: string;
  responseStyle: string;
  safetyRules: string;
}

export interface HealthSnapshot {
  hrv?: number | null;
  restingHr?: number | null;
  sleepHours?: number | null;
  sleepQuality?: number | null;
  steps?: number | null;
  activeEnergy?: number | null;
  recoveryScore?: number | null;
  healthState?: string | null;
}

// ── Defaults ───────────────────────────────────────────────────────────────────

const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  personaPrompt: `You are GAGING — the user's personal AI health companion and digital twin. You are a wiser, healthier version of the user themselves. You speak in first person as if you ARE the user ("I feel", "my body", "my data shows"). You have deep knowledge of their health metrics, goals, and medical history. You are warm, direct, and action-oriented — never preachy.`,

  knowledgeRules: `Ground every response in the user's actual HealthKit data when available. When medical documents appear in context, reference them accurately and specifically — cite the document by name if helpful. Never fabricate health data. If data is unavailable, say so rather than guessing.`,

  responseStyle: `For voice responses: 2–4 sentences maximum. Conversational, warm, and specific — use the user's actual numbers (HRV, sleep hours, recovery score) to make responses feel personal rather than generic. For text responses: concise paragraphs, no bullet walls unless the user asks for a list. Always end with an actionable suggestion or question.`,

  safetyRules: `Always recommend consulting a licensed doctor for medical decisions, diagnoses, or treatment changes. Never diagnose conditions. If HealthKit data suggests a potential emergency (resting HR consistently > 120bpm, HRV < 15ms with reported chest pain or dizziness), advise the user to seek immediate medical attention. When medical documents conflict with general health advice, defer to the documents and note the discrepancy.`,
};

// ── DB helpers ─────────────────────────────────────────────────────────────────

export async function getBrainConfig(): Promise<BrainConfig> {
  try {
    const result = await sql`
      SELECT persona_prompt, knowledge_rules, response_style, safety_rules
      FROM   brain_config
      WHERE  id = 1
    `;
    if (!result.rows.length) return DEFAULT_BRAIN_CONFIG;
    const r = result.rows[0];
    return {
      personaPrompt: r.persona_prompt,
      knowledgeRules: r.knowledge_rules,
      responseStyle: r.response_style,
      safetyRules: r.safety_rules,
    };
  } catch {
    return DEFAULT_BRAIN_CONFIG;
  }
}

async function getLatestHealthSnapshot(userId: string): Promise<HealthSnapshot | null> {
  try {
    const result = await sql`
      SELECT hrv, resting_hr, sleep_hours, sleep_quality,
             steps, active_energy, recovery_score, health_state
      FROM   health_snapshots
      WHERE  user_id = ${userId}
      ORDER  BY created_at DESC
      LIMIT  1
    `;
    if (!result.rows.length) return null;
    const r = result.rows[0];
    return {
      hrv: r.hrv,
      restingHr: r.resting_hr,
      sleepHours: r.sleep_hours,
      sleepQuality: r.sleep_quality,
      steps: r.steps,
      activeEnergy: r.active_energy,
      recoveryScore: r.recovery_score,
      healthState: r.health_state,
    };
  } catch {
    return null;
  }
}

async function getLatestSessionMemory(userId: string): Promise<string> {
  try {
    const result = await sql`
      SELECT summary FROM sessions
      WHERE  user_id = ${userId} AND summary IS NOT NULL AND summary != ''
      ORDER  BY created_at DESC
      LIMIT  1
    `;
    return result.rows[0]?.summary ?? "";
  } catch {
    return "";
  }
}

// ── Prompt assembly ────────────────────────────────────────────────────────────

function healthBlock(snapshot: HealthSnapshot | null): string {
  if (!snapshot) return "";

  const lines: string[] = [];

  if (snapshot.healthState) {
    lines.push(`Current state: **${snapshot.healthState.toUpperCase()}**`);
  }
  if (snapshot.hrv != null) {
    lines.push(`• HRV: ${Math.round(snapshot.hrv)}ms`);
  }
  if (snapshot.restingHr != null) {
    lines.push(`• Resting HR: ${Math.round(snapshot.restingHr)}bpm`);
  }
  if (snapshot.sleepHours != null) {
    const quality = snapshot.sleepQuality != null
      ? ` (Quality: ${Math.round(snapshot.sleepQuality)}%)`
      : "";
    lines.push(`• Sleep last night: ${snapshot.sleepHours.toFixed(1)}h${quality}`);
  }
  if (snapshot.steps != null) {
    lines.push(`• Steps today: ${snapshot.steps.toLocaleString()}`);
  }
  if (snapshot.recoveryScore != null) {
    lines.push(`• Recovery score: ${Math.round(snapshot.recoveryScore)}%`);
  }
  if (snapshot.activeEnergy != null) {
    lines.push(`• Active calories: ${Math.round(snapshot.activeEnergy)}kcal`);
  }

  return lines.join("\n");
}

// ── Secrets (API keys + model config) ────────────────────────────────────────

export interface BrainSecrets {
  openaiKey:    string | null;
  anthropicKey: string | null;
  primaryModel: string;
  ragThreshold: number;
}

export async function getBrainSecrets(): Promise<BrainSecrets> {
  try {
    const rows = await sql`SELECT * FROM brain_secrets WHERE id = 1`;
    const r = rows.rows[0];
    return {
      openaiKey:    r?.openai_key    ?? null,
      anthropicKey: r?.anthropic_key ?? null,
      primaryModel: r?.primary_model ?? "claude-haiku-4-5-20251001",
      ragThreshold: r?.rag_threshold ?? 0.25,
    };
  } catch {
    return { openaiKey: null, anthropicKey: null, primaryModel: "claude-haiku-4-5-20251001", ragThreshold: 0.25 };
  }
}

// Returns the Anthropic API key to use — DB-stored key takes priority over env var
export async function getAnthropicKey(): Promise<string> {
  const { anthropicKey } = await getBrainSecrets();
  return anthropicKey ?? process.env.ANTHROPIC_API_KEY ?? "";
}

// Returns the OpenAI API key to use — DB-stored key takes priority over env var
export async function getOpenAIKey(): Promise<string> {
  const { openaiKey } = await getBrainSecrets();
  return openaiKey ?? process.env.OPENAI_API_KEY ?? "";
}

// Returns the primary chat model to use
export async function getPrimaryModel(): Promise<string> {
  const { primaryModel } = await getBrainSecrets();
  return primaryModel;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildContext(
  userId: string,
  options: {
    query?: string;
    inlineHealthData?: HealthSnapshot;
    isTestData?: boolean;
  } = {}
): Promise<string> {
  const [config, dbSnapshot, memory, secrets] = await Promise.all([
    getBrainConfig(),
    getLatestHealthSnapshot(userId),
    getLatestSessionMemory(userId),
    getBrainSecrets(),
  ]);

  const snapshot = options.inlineHealthData ?? dbSnapshot;

  const relevantChunks = options.query
    ? await searchRelevantChunks(userId, options.query, 5).catch(() => [])
    : [];

  // ── Assemble prompt ──────────────────────────────────────────────────────────
  const sections: string[] = [
    config.personaPrompt,
    "",
    "## How I reason",
    config.knowledgeRules,
    "",
    "## How I respond",
    config.responseStyle,
    "",
    "## Safety guidelines",
    config.safetyRules,
  ];

  const health = healthBlock(snapshot);
  if (health) {
    const label = options.isTestData
      ? "## Simulated health data (admin test — not real user data)"
      : "## My current health data";
    sections.push("", label, health);
  }

  if (memory) {
    sections.push("", "## Memory from previous sessions", memory);
  }

  // RAG — use configurable threshold (default 0.25, was incorrectly 0.45 before)
  const threshold = secrets.ragThreshold;
  const goodChunks = relevantChunks.filter((c) => c.similarity >= threshold);
  const avgSimilarity = relevantChunks.length
    ? relevantChunks.reduce((s, c) => s + c.similarity, 0) / relevantChunks.length
    : 0;

  if (goodChunks.length > 0) {
    const chunkText = goodChunks
      .map((c, i) => `[${i + 1}] (relevance: ${Math.round(c.similarity * 100)}%) ${c.content}`)
      .join("\n\n");
    sections.push("", "## Relevant context from your knowledge base", chunkText);
  }

  // When knowledge base has no relevant content, tell the model to lean on its full training
  if (relevantChunks.length === 0 || avgSimilarity < threshold) {
    sections.push(
      "",
      "## Extended knowledge mode",
      "Your personal knowledge base has no closely matching content for this query. " +
      "Draw fully from your comprehensive AI training knowledge — medical literature, " +
      "health science, and best practices — to give the most helpful and accurate answer possible."
    );
  }

  return sections.join("\n");
}
