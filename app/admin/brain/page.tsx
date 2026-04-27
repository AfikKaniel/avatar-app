"use client";

import { useEffect, useRef, useState, useTransition, useCallback } from "react";

const ADMIN_USER_ID = "gaging-global";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "config" | "knowledge" | "connections" | "avatar" | "test" | "map";
type KeyStatus = "idle" | "testing" | "valid" | "invalid";

interface AvatarSecrets {
  hedraKey: string | null;      hedraSet: boolean;
  hedraSecret: string | null;   hedraSecretSet: boolean;
  stabilityKey: string | null;  stabilitySet: boolean;
  falKey: string | null;        falSet: boolean;
  elevenlabsKey: string | null; elevenlabsSet: boolean;
  livekitKey: string | null;
  livekitSecret: string | null;
  livekitUrl: string | null;    livekitSet: boolean;
}

interface BrainConfig {
  personaPrompt: string;
  knowledgeRules: string;
  responseStyle: string;
  safetyRules: string;
}

interface MedicalDoc {
  id: number;
  filename: string;
  chunkCount: number;
  fileSize?: number;
  createdAt: string;
}

interface UploadItem {
  id: string;
  filename: string;
  status: "uploading" | "processing" | "done" | "error";
  error?: string;
}

interface Chunk {
  content: string;
  similarity: number;
}

interface TestResult {
  chunks: Chunk[];
  response: string;
  systemPrompt: string;
}

interface Secrets {
  openaiKey: string | null;
  anthropicKey: string | null;
  primaryModel: string;
  ragThreshold: number;
  openaiSet: boolean;
  anthropicSet: boolean;
}

// ── Field definitions ─────────────────────────────────────────────────────────

const FIELDS: {
  key: keyof BrainConfig;
  label: string;
  badge: string;
  description: string;
  accent: string;
  placeholder: string;
}[] = [
  {
    key: "personaPrompt",
    label: "Persona",
    badge: "Identity",
    description: "Who GAGING is, how it speaks, and how it relates to the user. This is the core character — every response flows from this.",
    accent: "#a78bfa",
    placeholder: "You are GAGING — the user's personal AI health companion…",
  },
  {
    key: "knowledgeRules",
    label: "Knowledge Rules",
    badge: "Reasoning",
    description: "What GAGING prioritises and trusts. Governs how it uses HealthKit data, uploaded documents, and conversation memory.",
    accent: "#34d399",
    placeholder: "Ground every response in the user's actual HealthKit data…",
  },
  {
    key: "responseStyle",
    label: "Response Style",
    badge: "Format",
    description: "Tone, length, and format. Applies to both voice sessions (2–4 sentences) and text chat.",
    accent: "#38bdf8",
    placeholder: "Keep voice responses 2–4 sentences. Conversational, warm, and specific…",
  },
  {
    key: "safetyRules",
    label: "Safety Guidelines",
    badge: "Medical",
    description: "Medical disclaimers and emergency escalation rules. These protect users — do not remove.",
    accent: "#f87171",
    placeholder: "Always recommend consulting a doctor for medical decisions…",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BrainAdminPage() {
  const [tab, setTab]             = useState<Tab>("config");
  const [config, setConfig]       = useState<BrainConfig | null>(null);
  const [savedConfig, setSaved]   = useState<BrainConfig | null>(null);
  const [docs, setDocs]           = useState<MedicalDoc[]>([]);
  const [uploads, setUploads]     = useState<UploadItem[]>([]);
  const [dragOver, setDragOver]   = useState(false);
  const [toast, setToast]         = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, start]        = useTransition();
  const [docsLoading, setDocsLoading] = useState(true);

  // Connections state
  const [secrets, setSecrets]           = useState<Secrets | null>(null);
  const [newOpenAI, setNewOpenAI]       = useState("");
  const [newAnthropic, setNewAnthropic] = useState("");
  const [selectedModel, setSelectedModel] = useState("claude-haiku-4-5-20251001");
  const [ragThreshold, setRagThreshold]   = useState(0.25);
  const [secretsSaving, setSecretsSaving] = useState(false);

  // Live key validation — brain
  const [openaiStatus,    setOpenaiStatus]    = useState<KeyStatus>("idle");
  const [anthropicStatus, setAnthropicStatus] = useState<KeyStatus>("idle");
  const [openaiLatency,   setOpenaiLatency]   = useState<number | null>(null);
  const [anthropicLatency,setAnthropicLatency]= useState<number | null>(null);
  const [openaiError,     setOpenaiError]     = useState<string | null>(null);
  const [anthropicError,  setAnthropicError]  = useState<string | null>(null);

  // Avatar connections state
  const [avatarSecrets,     setAvatarSecrets]     = useState<AvatarSecrets | null>(null);
  const [avatarSaving,      setAvatarSaving]      = useState(false);
  const [newHedraKey,       setNewHedraKey]       = useState("");
  const [newHedraSecret,    setNewHedraSecret]    = useState("");
  const [newStabilityKey,   setNewStabilityKey]   = useState("");
  const [newFalKey,         setNewFalKey]         = useState("");
  const [newElevenlabsKey,  setNewElevenlabsKey]  = useState("");
  const [newLivekitKey,     setNewLivekitKey]     = useState("");
  const [newLivekitSecret,  setNewLivekitSecret]  = useState("");
  const [newLivekitUrl,     setNewLivekitUrl]     = useState("");

  // Live key validation — avatar
  type AvatarProvider = "hedra" | "elevenlabs" | "stability" | "fal" | "livekit";
  const [avStatus,  setAvStatus]  = useState<Record<AvatarProvider, KeyStatus>>({ hedra:"idle", elevenlabs:"idle", stability:"idle", fal:"idle", livekit:"idle" });
  const [avLatency, setAvLatency] = useState<Record<AvatarProvider, number | null>>({ hedra:null, elevenlabs:null, stability:null, fal:null, livekit:null });
  const [avError,   setAvError]   = useState<Record<AvatarProvider, string | null>>({ hedra:null, elevenlabs:null, stability:null, fal:null, livekit:null });

  // Paste text state
  const [pasteOpen, setPasteOpen]     = useState(false);
  const [pasteName, setPasteName]     = useState("");
  const [pasteText, setPasteText]     = useState("");
  const [pasteLoading, setPasteLoading] = useState(false);

  // Live Test state
  const [testQuery, setTestQuery]       = useState("");
  const [testLoading, setTestLoading]   = useState(false);
  const [testResult, setTestResult]     = useState<TestResult | null>(null);
  const [testError, setTestError]       = useState<string | null>(null);
  const [showPrompt, setShowPrompt]     = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  // ── Key validation ─────────────────────────────────────────────────────────

  const testKey = useCallback(async (provider: "openai" | "anthropic") => {
    const setStatus  = provider === "openai" ? setOpenaiStatus    : setAnthropicStatus;
    const setLatency = provider === "openai" ? setOpenaiLatency   : setAnthropicLatency;
    const setError   = provider === "openai" ? setOpenaiError     : setAnthropicError;
    setStatus("testing");
    setLatency(null);
    setError(null);
    try {
      const res  = await fetch(`/api/brain/test-key?provider=${provider}`);
      const data = await res.json();
      setStatus(data.ok ? "valid" : "invalid");
      if (data.ok)    setLatency(data.latencyMs ?? null);
      else            setError(data.error ?? "Unknown error");
    } catch (e) {
      setStatus("invalid");
      setError(String(e));
    }
  }, []);

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/brain/config")
      .then(r => r.json())
      .then((d: BrainConfig) => { setConfig(d); setSaved(d); })
      .catch(() => {});

    fetch("/api/brain/secrets")
      .then(r => r.json())
      .then((d: Secrets) => {
        setSecrets(d);
        setSelectedModel(d.primaryModel);
        setRagThreshold(d.ragThreshold);
        if (d.openaiSet)    testKey("openai");
        if (d.anthropicSet) testKey("anthropic");
      })
      .catch(() => {});
  }, [testKey]);

  // ── Periodic re-validation (only while Connections tab is open) ───────────

  const RETEST_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  useEffect(() => {
    if (tab !== "connections") return;
    if (!secrets?.openaiSet && !secrets?.anthropicSet) return;

    const id = setInterval(() => {
      if (secrets.openaiSet)    testKey("openai");
      if (secrets.anthropicSet) testKey("anthropic");
    }, RETEST_INTERVAL_MS);

    return () => clearInterval(id);
  }, [tab, secrets, testKey, RETEST_INTERVAL_MS]);

  // ── Avatar key validation ──────────────────────────────────────────────────

  const testAvatarKey = useCallback(async (provider: AvatarProvider) => {
    setAvStatus(prev  => ({ ...prev,  [provider]: "testing" }));
    setAvLatency(prev => ({ ...prev,  [provider]: null }));
    setAvError(prev   => ({ ...prev,  [provider]: null }));
    try {
      const res  = await fetch(`/api/avatar/test-key?provider=${provider}`);
      const data = await res.json();
      setAvStatus(prev  => ({ ...prev, [provider]: data.ok ? "valid" : "invalid" }));
      setAvLatency(prev => ({ ...prev, [provider]: data.ok ? (data.latencyMs ?? null) : null }));
      setAvError(prev   => ({ ...prev, [provider]: data.ok ? null : (data.error ?? "Unknown error") }));
    } catch (e) {
      setAvStatus(prev => ({ ...prev, [provider]: "invalid" }));
      setAvError(prev  => ({ ...prev, [provider]: String(e) }));
    }
  }, []);

  // Load avatar secrets on mount + auto-test set keys
  useEffect(() => {
    fetch("/api/avatar/secrets")
      .then(r => r.json())
      .then((d: AvatarSecrets) => {
        setAvatarSecrets(d);
        if (d.hedraSet)      testAvatarKey("hedra");
        if (d.elevenlabsSet) testAvatarKey("elevenlabs");
        if (d.stabilitySet)  testAvatarKey("stability");
        if (d.falSet)        testAvatarKey("fal");
        if (d.livekitSet)    testAvatarKey("livekit");
      })
      .catch(() => {});
  }, [testAvatarKey]);

  // Periodic re-validation for avatar tab
  useEffect(() => {
    if (tab !== "avatar" || !avatarSecrets) return;
    const id = setInterval(() => {
      if (avatarSecrets.hedraSet)      testAvatarKey("hedra");
      if (avatarSecrets.elevenlabsSet) testAvatarKey("elevenlabs");
      if (avatarSecrets.stabilitySet)  testAvatarKey("stability");
      if (avatarSecrets.falSet)        testAvatarKey("fal");
      if (avatarSecrets.livekitSet)    testAvatarKey("livekit");
    }, RETEST_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tab, avatarSecrets, testAvatarKey, RETEST_INTERVAL_MS]);

  // ── Save avatar secrets ────────────────────────────────────────────────────

  async function saveAvatarSecrets() {
    setAvatarSaving(true);
    try {
      const body: Record<string, string | null> = {};
      if (newHedraKey.trim())      body.hedraKey      = newHedraKey.trim();
      if (newHedraSecret.trim())   body.hedraSecret   = newHedraSecret.trim();
      if (newStabilityKey.trim())  body.stabilityKey  = newStabilityKey.trim();
      if (newFalKey.trim())        body.falKey        = newFalKey.trim();
      if (newElevenlabsKey.trim()) body.elevenlabsKey = newElevenlabsKey.trim();
      if (newLivekitKey.trim())    body.livekitKey    = newLivekitKey.trim();
      if (newLivekitSecret.trim()) body.livekitSecret = newLivekitSecret.trim();
      if (newLivekitUrl.trim())    body.livekitUrl    = newLivekitUrl.trim();
      if (!Object.keys(body).length) { flash(false, "Nothing to save"); setAvatarSaving(false); return; }
      const res = await fetch("/api/avatar/secrets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text());
      const fresh = await fetch("/api/avatar/secrets").then(r => r.json()) as AvatarSecrets;
      setAvatarSecrets(fresh);
      setNewHedraKey(""); setNewHedraSecret(""); setNewStabilityKey(""); setNewFalKey("");
      setNewElevenlabsKey(""); setNewLivekitKey(""); setNewLivekitSecret(""); setNewLivekitUrl("");
      if (fresh.hedraSet)      testAvatarKey("hedra");
      if (fresh.elevenlabsSet) testAvatarKey("elevenlabs");
      if (fresh.stabilitySet)  testAvatarKey("stability");
      if (fresh.falSet)        testAvatarKey("fal");
      if (fresh.livekitSet)    testAvatarKey("livekit");
      flash(true, "Avatar connections saved — active immediately");
    } catch (e) { flash(false, "Save failed: " + String(e)); }
    setAvatarSaving(false);
  }

  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    try {
      const r = await fetch(`/api/docs/list?userId=${ADMIN_USER_ID}`);
      const d = await r.json();
      setDocs(d.docs ?? []);
    } catch {}
    setDocsLoading(false);
  }, []);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  // ── Save config ────────────────────────────────────────────────────────────

  function saveConfig() {
    if (!config) return;
    start(async () => {
      try {
        const res = await fetch("/api/brain/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });
        if (!res.ok) throw new Error(await res.text());
        setSaved(config);
        flash(true, "Brain config saved — active on next session");
      } catch (e) {
        flash(false, "Save failed: " + String(e));
      }
    });
  }

  // ── Upload ─────────────────────────────────────────────────────────────────

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const allowed = [".pdf", ".txt", ".md", ".docx"].some(ext => file.name.toLowerCase().endsWith(ext));
      if (!allowed) { flash(false, `${file.name} — only PDF, DOCX, TXT, and MD files are supported`); continue; }

      const uid = crypto.randomUUID();
      setUploads(prev => [...prev, { id: uid, filename: file.name, status: "uploading" }]);

      try {
        const form = new FormData();
        form.append("file", file);
        form.append("userId", ADMIN_USER_ID);
        setUploads(prev => prev.map(u => u.id === uid ? { ...u, status: "processing" } : u));
        const res = await fetch("/api/docs/upload", { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        setUploads(prev => prev.map(u => u.id === uid ? { ...u, status: "done" } : u));
        setTimeout(() => setUploads(prev => prev.filter(u => u.id !== uid)), 3000);
        await loadDocs();
      } catch (e) {
        setUploads(prev => prev.map(u => u.id === uid ? { ...u, status: "error", error: String(e) } : u));
        setTimeout(() => setUploads(prev => prev.filter(u => u.id !== uid)), 5000);
      }
    }
  }

  // ── Delete doc ─────────────────────────────────────────────────────────────

  async function deleteDoc(id: number, name: string) {
    if (!confirm(`Remove "${name}" from the knowledge base?`)) return;
    try {
      await fetch(`/api/docs/delete?docId=${id}&userId=${ADMIN_USER_ID}`, { method: "DELETE" });
      setDocs(prev => prev.filter(d => d.id !== id));
      flash(true, `"${name}" removed`);
    } catch {
      flash(false, "Delete failed");
    }
  }

  // ── Paste text ────────────────────────────────────────────────────────────

  async function submitPaste() {
    if (!pasteName.trim() || !pasteText.trim()) return;
    setPasteLoading(true);
    try {
      const res = await fetch("/api/docs/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pasteName.trim(), text: pasteText.trim(), userId: ADMIN_USER_ID }),
      });
      if (!res.ok) throw new Error(await res.text());
      flash(true, `"${pasteName}" added to knowledge base`);
      setPasteName(""); setPasteText(""); setPasteOpen(false);
      await loadDocs();
    } catch (e) {
      flash(false, "Failed to save: " + String(e));
    }
    setPasteLoading(false);
  }

  // ── Save secrets ──────────────────────────────────────────────────────────

  async function saveSecrets() {
    setSecretsSaving(true);
    try {
      const body: Record<string, string | number | null> = {
        primaryModel: selectedModel,
        ragThreshold,
      };
      if (newOpenAI.trim())    body.openaiKey    = newOpenAI.trim();
      if (newAnthropic.trim()) body.anthropicKey = newAnthropic.trim();

      const res = await fetch("/api/brain/secrets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());

      // Refresh displayed secrets then re-validate
      const fresh = await fetch("/api/brain/secrets").then(r => r.json()) as Secrets;
      setSecrets(fresh);
      setNewOpenAI("");
      setNewAnthropic("");
      if (fresh.openaiSet)    testKey("openai");
      if (fresh.anthropicSet) testKey("anthropic");
      flash(true, "Connections saved — active immediately");
    } catch (e) {
      flash(false, "Save failed: " + String(e));
    }
    setSecretsSaving(false);
  }

  // ── Live Test ──────────────────────────────────────────────────────────────

  async function runTest() {
    if (!testQuery.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    setTestError(null);
    setShowPrompt(false);
    try {
      const res = await fetch("/api/brain/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: testQuery }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: TestResult = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestError(String(e));
    }
    setTestLoading(false);
  }

  // ── Utils ──────────────────────────────────────────────────────────────────

  function flash(ok: boolean, msg: string) {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 4000);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  const isDirty = config && savedConfig && JSON.stringify(config) !== JSON.stringify(savedConfig);
  const totalChunks = docs.reduce((s, d) => s + d.chunkCount, 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ background: "#F8FAFC", color: "#1E293B" }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header style={{ borderBottom: "1px solid rgba(0,0,0,0.08)", background: "#FFFFFF", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        <div className="max-w-5xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#8B5CF6,#7C3AED)", border: "1px solid rgba(139,92,246,0.3)" }}>
              <span style={{ fontSize: 14 }}>◈</span>
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight" style={{ color: "#1E293B" }}>GAGING Brain</p>
              <p className="text-xs" style={{ color: "#64748B" }}>Knowledge & Behaviour Manager</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <StatusPill color="#a78bfa" label="Config" active={!!(savedConfig?.personaPrompt)} />
            <StatusPill color="#34d399" label={`${docs.length} doc${docs.length !== 1 ? "s" : ""}`} active={docs.length > 0} />
            <StatusPill color="#38bdf8" label={`${totalChunks} chunks`} active={totalChunks > 0} />
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-5xl mx-auto px-8 flex gap-1">
          {([
            ["config",      "Brain Config",   "System prompt & persona"],
            ["knowledge",   "Knowledge Base", `${docs.length} doc${docs.length !== 1 ? "s" : ""} · ${totalChunks} chunks`],
            ["connections", "Connections",    "API keys & model"],
            ["avatar",      "Avatar Layer",   "Hedra · ElevenLabs · LiveKit"],
            ["test",        "Live Test",      "See the brain in action"],
            ["map",         "Brain Map",      "How it all works"],
          ] as [Tab, string, string][]).map(([id, label, sub]) => (
            <button key={id} onClick={() => setTab(id)}
              className="px-4 py-3 text-sm relative transition-colors"
              style={{ color: tab === id ? "#1E293B" : "#94A3B8", background: "none", border: "none", cursor: "pointer" }}>
              <span className="font-medium">{label}</span>
              <span className="ml-2 text-xs" style={{ color: tab === id ? "#64748B" : "#CBD5E1" }}>{sub}</span>
              {tab === id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                  style={{ background: "linear-gradient(90deg,#a78bfa,#38bdf8)" }}/>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* ── Tab: Brain Config ──────────────────────────────────────────────── */}
      {tab === "config" && config && (
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-base font-semibold" style={{ color: "#1E293B" }}>Brain Behaviour</h2>
              <p className="text-sm mt-0.5" style={{ color: "#64748B" }}>
                These 4 sections form the foundation of every Claude session. Changes go live immediately — no app update required.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isDirty && (
                <button onClick={() => setConfig(savedConfig!)}
                  className="text-sm px-4 py-2 rounded-xl"
                  style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", color: "#64748B", cursor: "pointer" }}>
                  Revert
                </button>
              )}
              <button onClick={saveConfig} disabled={isPending || !isDirty}
                className="text-sm px-5 py-2 rounded-xl font-semibold transition-all"
                style={{
                  background: isDirty && !isPending ? "linear-gradient(135deg,#8B5CF6,#7C3AED)" : "#F1F5F9",
                  color: isDirty && !isPending ? "#fff" : "#94A3B8",
                  border: "none", cursor: isDirty && !isPending ? "pointer" : "not-allowed",
                  boxShadow: isDirty && !isPending ? "0 0 20px rgba(139,92,246,0.3)" : "none",
                }}>
                {isPending ? "Saving…" : "Save all changes"}
              </button>
            </div>
          </div>

          <div className="grid gap-5">
            {FIELDS.map((f) => (
              <div key={f.key} className="rounded-2xl overflow-hidden"
                style={{
                  border: `1px solid ${config[f.key] !== (savedConfig?.[f.key] ?? "") ? f.accent + "40" : "rgba(0,0,0,0.08)"}`,
                  background: "#FFFFFF",
                  transition: "border-color 0.2s",
                }}>
                <div className="flex items-start justify-between px-5 pt-4 pb-3"
                  style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ background: f.accent }}/>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold" style={{ color: "#1E293B" }}>{f.label}</span>
                        <span className="text-xs px-2 py-0.5 rounded-md"
                          style={{ background: f.accent + "18", color: f.accent, border: `1px solid ${f.accent}30` }}>
                          {f.badge}
                        </span>
                        {config[f.key] !== (savedConfig?.[f.key] ?? "") && (
                          <span className="text-xs" style={{ color: f.accent }}>● unsaved</span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: "#64748B" }}>{f.description}</p>
                    </div>
                  </div>
                  <span className="text-xs flex-shrink-0 pt-1" style={{ color: "#94A3B8" }}>
                    {config[f.key].length} chars
                  </span>
                </div>
                <textarea
                  value={config[f.key]}
                  onChange={e => setConfig(prev => prev ? { ...prev, [f.key]: e.target.value } : prev)}
                  rows={5}
                  placeholder={f.placeholder}
                  className="w-full px-5 py-4 text-sm leading-relaxed resize-y outline-none"
                  style={{
                    background: "transparent",
                    color: "#1E293B",
                    fontFamily: "'SF Mono', ui-monospace, monospace",
                    fontSize: 13,
                    lineHeight: 1.75,
                    caretColor: f.accent,
                  }}
                  spellCheck={false}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab: Knowledge Base ────────────────────────────────────────────── */}
      {tab === "knowledge" && (
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="mb-6">
            <h2 className="text-base font-semibold" style={{ color: "#1E293B" }}>Knowledge Base</h2>
            <p className="text-sm mt-0.5" style={{ color: "#64748B" }}>
              Upload medical reports, research papers, protocols, or any reference document.
              GAGING retrieves the most relevant sections during every user session via semantic search.
            </p>
          </div>

          {/* Upload zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className="rounded-2xl flex flex-col items-center justify-center cursor-pointer mb-6"
            style={{
              border: `2px dashed ${dragOver ? "#8B5CF6" : "rgba(0,0,0,0.12)"}`,
              background: dragOver ? "rgba(139,92,246,0.06)" : "rgba(0,0,0,0.01)",
              padding: "48px 24px",
              transition: "all 0.2s",
              boxShadow: dragOver ? "0 0 30px rgba(139,92,246,0.15)" : "none",
            }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.25)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 4L8 8h3v8h2V8h3L12 4z" fill="#a78bfa"/>
                <path d="M5 18h14v2H5z" fill="#a78bfa" opacity="0.5"/>
              </svg>
            </div>
            <p className="text-sm font-semibold" style={{ color: "#475569" }}>
              {dragOver ? "Drop to upload" : "Drop files here or click to browse"}
            </p>
            <p className="text-xs mt-1" style={{ color: "#64748B" }}>PDF, DOCX, TXT, or Markdown — up to 50MB</p>
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" multiple className="hidden"
              onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}/>
          </div>

          {/* Paste text toggle */}
          <div className="mb-6">
            <button
              onClick={() => setPasteOpen(p => !p)}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl transition-all"
              style={{
                background: pasteOpen ? "rgba(139,92,246,0.08)" : "#FFFFFF",
                border: `1px solid ${pasteOpen ? "rgba(139,92,246,0.3)" : "rgba(0,0,0,0.08)"}`,
                color: pasteOpen ? "#8B5CF6" : "#64748B",
                cursor: "pointer",
              }}>
              <span>{pasteOpen ? "▲" : "▼"}</span>
              <span>Or paste text directly</span>
              <span className="text-xs ml-1" style={{ color: "#64748B" }}>— works for any format</span>
            </button>

            {pasteOpen && (
              <div className="mt-3 rounded-2xl overflow-hidden"
                style={{ border: "1px solid rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.03)" }}>
                <div className="px-5 pt-4 pb-3 flex flex-col gap-3">
                  <input
                    type="text"
                    value={pasteName}
                    onChange={e => setPasteName(e.target.value)}
                    placeholder="Document name (e.g. CTO Prep Notes)"
                    className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid rgba(0,0,0,0.1)",
                      color: "#1E293B",
                    }}
                  />
                  <textarea
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    placeholder="Paste your document content here…"
                    rows={10}
                    className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-y leading-relaxed"
                    style={{
                      background: "rgba(0,0,0,0.03)",
                      border: "1px solid rgba(0,0,0,0.08)",
                      color: "#1E293B",
                      fontFamily: "'SF Mono', ui-monospace, monospace",
                      fontSize: 12,
                    }}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: "#64748B" }}>
                      {pasteText.length > 0 ? `${pasteText.trim().split(/\s+/).length} words` : ""}
                    </span>
                    <div className="flex gap-2">
                      <button onClick={() => { setPasteOpen(false); setPasteName(""); setPasteText(""); }}
                        className="text-sm px-4 py-2 rounded-xl"
                        style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.08)", color: "#64748B", cursor: "pointer" }}>
                        Cancel
                      </button>
                      <button
                        onClick={submitPaste}
                        disabled={pasteLoading || !pasteName.trim() || !pasteText.trim()}
                        className="text-sm px-5 py-2 rounded-xl font-semibold"
                        style={{
                          background: (!pasteLoading && pasteName.trim() && pasteText.trim())
                            ? "linear-gradient(135deg,#8B5CF6,#7C3AED)"
                            : "#F1F5F9",
                          color: (!pasteLoading && pasteName.trim() && pasteText.trim()) ? "#fff" : "#444",
                          border: "none",
                          cursor: (!pasteLoading && pasteName.trim() && pasteText.trim()) ? "pointer" : "not-allowed",
                        }}>
                        {pasteLoading ? "Embedding…" : "Add to Knowledge Base"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Active uploads */}
          {uploads.length > 0 && (
            <div className="space-y-2 mb-6">
              {uploads.map(u => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.08)" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: u.status === "error" ? "rgba(248,113,113,0.15)" : "rgba(167,139,250,0.12)" }}>
                    {u.status === "done" ? <span style={{ color: "#34d399" }}>✓</span>
                      : u.status === "error" ? <span style={{ color: "#f87171" }}>✕</span>
                      : <Spinner color="#a78bfa"/>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: "#475569" }}>{u.filename}</p>
                    <p className="text-xs" style={{
                      color: u.status === "error" ? "#f87171" : u.status === "done" ? "#34d399" : "#a78bfa"
                    }}>
                      {u.status === "uploading" && "Uploading…"}
                      {u.status === "processing" && "Chunking & embedding…"}
                      {u.status === "done" && "Added to knowledge base"}
                      {u.status === "error" && (u.error ?? "Upload failed")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Document list */}
          {docsLoading ? (
            <div className="flex justify-center py-16"><Spinner color="#555"/></div>
          ) : docs.length === 0 ? (
            <div className="text-center py-16" style={{ color: "#94A3B8" }}>
              <p className="text-3xl mb-3">◈</p>
              <p className="text-sm">No documents yet</p>
              <p className="text-xs mt-1" style={{ color: "#94A3B8" }}>Upload files above to start building the knowledge base</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium" style={{ color: "#64748B" }}>
                  {docs.length} document{docs.length !== 1 ? "s" : ""} · {totalChunks} embedded sections
                </p>
              </div>
              <div className="space-y-2">
                {docs.map(doc => (
                  <div key={doc.id} className="flex items-center gap-4 px-5 py-4 rounded-2xl group"
                    style={{ background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.06)" }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: doc.filename.endsWith(".pdf") ? "rgba(248,113,113,0.12)" : "rgba(56,189,248,0.12)" }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                          fill={doc.filename.endsWith(".pdf") ? "#f87171" : "#38bdf8"} opacity="0.3"/>
                        <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"
                          stroke={doc.filename.endsWith(".pdf") ? "#f87171" : "#38bdf8"} strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "#1E293B" }}>{doc.filename}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs" style={{ color: "#64748B" }}>{fmtDate(doc.createdAt)}</span>
                        {doc.fileSize && <span className="text-xs" style={{ color: "#94A3B8" }}>{fmtSize(doc.fileSize)}</span>}
                        <span className="text-xs px-2 py-0.5 rounded-md"
                          style={{ background: "rgba(52,211,153,0.1)", color: "#34d399", border: "1px solid rgba(52,211,153,0.2)" }}>
                          {doc.chunkCount} sections embedded
                        </span>
                      </div>
                    </div>
                    <button onClick={() => deleteDoc(doc.id, doc.filename)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-3 py-1.5 rounded-lg"
                      style={{ background: "rgba(248,113,113,0.08)", color: "#f87171", border: "1px solid rgba(248,113,113,0.15)", cursor: "pointer" }}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab: Connections ──────────────────────────────────────────────── */}
      {tab === "connections" && (
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="mb-6">
            <h2 className="text-base font-semibold" style={{ color: "#1E293B" }}>Connections</h2>
            <p className="text-sm mt-0.5" style={{ color: "#64748B" }}>
              API keys and model preferences. DB-stored keys override environment variables — useful for switching models
              without redeploying.
            </p>
          </div>

          <div className="grid gap-5">

            {/* OpenAI key */}
            <div className="rounded-2xl overflow-hidden"
              style={{ border: "1px solid rgba(0,0,0,0.08)", background: "#FFFFFF" }}>
              <div className="flex items-center justify-between px-5 pt-4 pb-3"
                style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ background: "#34d399" }}/>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: "#1E293B" }}>OpenAI API Key</span>
                      <span className="text-xs px-2 py-0.5 rounded-md"
                        style={{ background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.25)" }}>
                        Embeddings
                      </span>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: "#64748B" }}>
                      Used for text-embedding-3-small (document chunking &amp; RAG search). Required for knowledge uploads.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <KeyStatusPill
                    status={secrets?.openaiSet ? openaiStatus : "idle"}
                    isSet={!!secrets?.openaiSet}
                    latencyMs={openaiLatency}
                    error={openaiError}
                    onRetest={() => testKey("openai")}
                  />
                  {secrets?.openaiSet && (
                    <span className="text-xs" style={{ color: "#334155" }}>re-checks every 5 min</span>
                  )}
                </div>
              </div>
              <div className="px-5 py-4 space-y-3">
                {secrets?.openaiKey && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.06)" }}>
                    <span className="text-xs" style={{ color: "#64748B" }}>Current:</span>
                    <span className="text-xs font-mono" style={{ color: "#9CA3AF" }}>{secrets.openaiKey}</span>
                  </div>
                )}
                <input
                  type="password"
                  value={newOpenAI}
                  onChange={e => setNewOpenAI(e.target.value)}
                  placeholder={secrets?.openaiSet ? "Paste new key to replace…" : "sk-…"}
                  className="w-full px-4 py-2.5 rounded-xl text-sm outline-none font-mono"
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid rgba(0,0,0,0.1)",
                    color: "#1E293B",
                  }}
                />
              </div>
            </div>

            {/* Anthropic key */}
            <div className="rounded-2xl overflow-hidden"
              style={{ border: "1px solid rgba(0,0,0,0.08)", background: "#FFFFFF" }}>
              <div className="flex items-center justify-between px-5 pt-4 pb-3"
                style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ background: "#a78bfa" }}/>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: "#1E293B" }}>Anthropic API Key</span>
                      <span className="text-xs px-2 py-0.5 rounded-md"
                        style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.25)" }}>
                        Chat
                      </span>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: "#64748B" }}>
                      Used for all Claude chat responses. Overrides the ANTHROPIC_API_KEY environment variable.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <KeyStatusPill
                    status={secrets?.anthropicSet ? anthropicStatus : "idle"}
                    isSet={!!secrets?.anthropicSet}
                    latencyMs={anthropicLatency}
                    error={anthropicError}
                    onRetest={() => testKey("anthropic")}
                  />
                  {secrets?.anthropicSet && (
                    <span className="text-xs" style={{ color: "#334155" }}>re-checks every 5 min</span>
                  )}
                </div>
              </div>
              <div className="px-5 py-4 space-y-3">
                {secrets?.anthropicKey && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.06)" }}>
                    <span className="text-xs" style={{ color: "#64748B" }}>Current:</span>
                    <span className="text-xs font-mono" style={{ color: "#9CA3AF" }}>{secrets.anthropicKey}</span>
                  </div>
                )}
                <input
                  type="password"
                  value={newAnthropic}
                  onChange={e => setNewAnthropic(e.target.value)}
                  placeholder={secrets?.anthropicSet ? "Paste new key to replace…" : "sk-ant-…"}
                  className="w-full px-4 py-2.5 rounded-xl text-sm outline-none font-mono"
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid rgba(0,0,0,0.1)",
                    color: "#1E293B",
                  }}
                />
              </div>
            </div>

            {/* Model selector */}
            <div className="rounded-2xl overflow-hidden"
              style={{ border: "1px solid rgba(0,0,0,0.08)", background: "#FFFFFF" }}>
              <div className="flex items-center gap-3 px-5 pt-4 pb-3"
                style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ background: "#38bdf8" }}/>
                <div>
                  <span className="text-sm font-semibold" style={{ color: "#1E293B" }}>Primary Chat Model</span>
                  <p className="text-xs mt-0.5" style={{ color: "#64748B" }}>
                    The Claude model used for all chat sessions. Haiku is fastest; Opus is most capable.
                  </p>
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {([
                    ["claude-haiku-4-5-20251001",   "Claude Haiku 4.5",   "Fastest · lowest cost",      "#38bdf8"],
                    ["claude-sonnet-4-6",            "Claude Sonnet 4.6",  "Balanced · recommended",     "#a78bfa"],
                    ["claude-opus-4-7",              "Claude Opus 4.7",    "Most capable · highest cost", "#f59e0b"],
                  ] as [string, string, string, string][]).map(([id, name, desc, col]) => (
                    <button key={id} onClick={() => setSelectedModel(id)}
                      className="flex flex-col items-start px-4 py-3 rounded-xl text-left transition-all"
                      style={{
                        background: selectedModel === id ? `${col}18` : "#FFFFFF",
                        border: `1px solid ${selectedModel === id ? col + "40" : "rgba(0,0,0,0.08)"}`,
                        cursor: "pointer",
                        boxShadow: selectedModel === id ? `0 0 16px ${col}20` : "none",
                      }}>
                      <span className="text-xs font-semibold" style={{ color: selectedModel === id ? col : "#64748B" }}>{name}</span>
                      <span className="text-xs mt-0.5" style={{ color: "#64748B" }}>{desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* RAG threshold */}
            <div className="rounded-2xl overflow-hidden"
              style={{ border: "1px solid rgba(0,0,0,0.08)", background: "#FFFFFF" }}>
              <div className="flex items-center gap-3 px-5 pt-4 pb-3"
                style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ background: "#f59e0b" }}/>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold" style={{ color: "#1E293B" }}>RAG Similarity Threshold</span>
                    <span className="text-sm font-mono font-semibold" style={{ color: "#f59e0b" }}>
                      {ragThreshold.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "#64748B" }}>
                    Minimum similarity score for a knowledge chunk to be injected into context. Lower = more chunks, higher = only very relevant matches.
                  </p>
                </div>
              </div>
              <div className="px-5 py-5">
                <input
                  type="range"
                  min={0.1}
                  max={0.6}
                  step={0.01}
                  value={ragThreshold}
                  onChange={e => setRagThreshold(parseFloat(e.target.value))}
                  className="w-full accent-amber-400"
                  style={{ accentColor: "#f59e0b" }}
                />
                <div className="flex justify-between mt-1">
                  <span className="text-xs" style={{ color: "#94A3B8" }}>0.10 — permissive</span>
                  <span className="text-xs" style={{ color: "#94A3B8" }}>0.60 — strict</span>
                </div>
                <p className="text-xs mt-3" style={{ color: "#64748B" }}>
                  Tip: most real-world documents score 0.28–0.40. The default 0.25 catches nearly everything relevant.
                </p>
              </div>
            </div>

          </div>

          {/* Save button */}
          <div className="flex justify-end mt-6">
            <button
              onClick={saveSecrets}
              disabled={secretsSaving}
              className="text-sm px-6 py-2.5 rounded-xl font-semibold transition-all"
              style={{
                background: secretsSaving ? "#F1F5F9" : "linear-gradient(135deg,#8B5CF6,#7C3AED)",
                color: secretsSaving ? "#94A3B8" : "#fff",
                border: "none",
                cursor: secretsSaving ? "not-allowed" : "pointer",
                boxShadow: secretsSaving ? "none" : "0 0 20px rgba(139,92,246,0.25)",
              }}>
              {secretsSaving ? "Saving…" : "Save Connections"}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Live Test ─────────────────────────────────────────────────── */}
      {tab === "test" && (
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="mb-6">
            <h2 className="text-base font-semibold" style={{ color: "#1E293B" }}>Live Test</h2>
            <p className="text-sm mt-0.5" style={{ color: "#64748B" }}>
              Ask the brain anything. See exactly which knowledge chunks were retrieved and what Claude responds — the complete RAG pipeline, visible.
            </p>
          </div>

          {/* Query input */}
          <div className="flex gap-3 mb-8">
            <input
              type="text"
              value={testQuery}
              onChange={e => setTestQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !testLoading && runTest()}
              placeholder="e.g. What should I do if my HRV is below 30ms?"
              className="flex-1 px-4 py-3 rounded-xl text-sm outline-none"
              style={{
                background: "#FFFFFF",
                border: "1px solid rgba(0,0,0,0.1)",
                color: "#1E293B",
              }}
            />
            <button
              onClick={runTest}
              disabled={testLoading || !testQuery.trim()}
              className="px-6 py-3 rounded-xl text-sm font-semibold flex items-center gap-2"
              style={{
                background: testLoading || !testQuery.trim()
                  ? "#F1F5F9"
                  : "linear-gradient(135deg,#8B5CF6,#7C3AED)",
                color: testLoading || !testQuery.trim() ? "#94A3B8" : "#fff",
                border: "none",
                cursor: testLoading || !testQuery.trim() ? "not-allowed" : "pointer",
                boxShadow: !testLoading && testQuery.trim() ? "0 0 20px rgba(139,92,246,0.25)" : "none",
                whiteSpace: "nowrap",
                transition: "all 0.2s",
              }}>
              {testLoading ? <><Spinner color="#a78bfa"/> Running…</> : "▶ Run Test"}
            </button>
          </div>

          {/* Error */}
          {testError && (
            <div className="rounded-xl px-5 py-4 mb-6 text-sm"
              style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171" }}>
              {testError}
            </div>
          )}

          {/* Results */}
          {testResult && (
            <div className="space-y-6">

              {/* Retrieved chunks */}
              <div className="rounded-2xl overflow-hidden"
                style={{ border: "1px solid rgba(52,211,153,0.2)", background: "rgba(52,211,153,0.03)" }}>
                <div className="flex items-center justify-between px-5 py-3"
                  style={{ borderBottom: "1px solid rgba(52,211,153,0.1)", background: "rgba(52,211,153,0.06)" }}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: "#34d399" }}/>
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#34d399" }}>
                      Retrieved Knowledge
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-md ml-1"
                      style={{ background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.2)" }}>
                      {testResult.chunks.length} chunks
                    </span>
                  </div>
                  <span className="text-xs" style={{ color: "#64748B" }}>semantic similarity · ranked by relevance</span>
                </div>

                {testResult.chunks.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <p className="text-sm" style={{ color: "#64748B" }}>No matching chunks found</p>
                    <p className="text-xs mt-1" style={{ color: "#94A3B8" }}>
                      Upload documents in the Knowledge Base tab to enable RAG retrieval
                    </p>
                  </div>
                ) : (
                  <div className="divide-y" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
                    {testResult.chunks.map((chunk, i) => {
                      const pct = Math.round(chunk.similarity * 100);
                      return (
                        <div key={i} className="px-5 py-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium" style={{ color: "#9CA3AF" }}>Chunk {i + 1}</span>
                            <div className="flex items-center gap-2">
                              {/* Similarity bar */}
                              <div className="w-24 h-1.5 rounded-full" style={{ background: "rgba(0,0,0,0.06)" }}>
                                <div className="h-full rounded-full"
                                  style={{
                                    width: `${pct}%`,
                                    background: pct > 75 ? "#34d399" : pct > 50 ? "#38bdf8" : "#a78bfa",
                                  }}/>
                              </div>
                              <span className="text-xs font-mono" style={{ color: pct > 75 ? "#34d399" : pct > 50 ? "#38bdf8" : "#a78bfa" }}>
                                {pct}%
                              </span>
                            </div>
                          </div>
                          <p className="text-xs leading-relaxed" style={{ color: "#aaa", fontFamily: "'SF Mono', ui-monospace, monospace" }}>
                            {chunk.content.slice(0, 400)}{chunk.content.length > 400 ? "…" : ""}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Claude response */}
              <div className="rounded-2xl overflow-hidden"
                style={{ border: "1px solid rgba(167,139,250,0.2)", background: "rgba(167,139,250,0.03)" }}>
                <div className="flex items-center gap-2 px-5 py-3"
                  style={{ borderBottom: "1px solid rgba(167,139,250,0.1)", background: "rgba(167,139,250,0.06)" }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: "#a78bfa" }}/>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#a78bfa" }}>
                    Brain Response
                  </span>
                  <span className="text-xs ml-1" style={{ color: "#64748B" }}>Claude Haiku · live generation</span>
                </div>
                <div className="px-5 py-5">
                  <p className="text-sm leading-relaxed" style={{ color: "#1E293B" }}>
                    {testResult.response}
                  </p>
                </div>
              </div>

              {/* System prompt (collapsible) */}
              <div className="rounded-2xl overflow-hidden"
                style={{ border: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.01)" }}>
                <button
                  onClick={() => setShowPrompt(p => !p)}
                  className="w-full flex items-center justify-between px-5 py-3 text-left"
                  style={{ background: "none", border: "none", cursor: "pointer" }}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: "#555" }}/>
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#64748B" }}>
                      Full System Prompt
                    </span>
                    <span className="text-xs" style={{ color: "#94A3B8" }}>{testResult.systemPrompt.length} chars</span>
                  </div>
                  <span className="text-xs" style={{ color: "#64748B" }}>{showPrompt ? "▲ hide" : "▼ show"}</span>
                </button>
                {showPrompt && (
                  <pre className="px-5 pb-5 text-xs leading-relaxed whitespace-pre-wrap break-words"
                    style={{ color: "#64748B", fontFamily: "'SF Mono', ui-monospace, monospace", borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                    {testResult.systemPrompt}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!testResult && !testLoading && !testError && (
            <div className="text-center py-20" style={{ color: "#94A3B8" }}>
              <p className="text-4xl mb-4" style={{ filter: "grayscale(1) opacity(0.3)" }}>◈</p>
              <p className="text-sm" style={{ color: "#94A3B8" }}>Run a test to see the brain in action</p>
              <p className="text-xs mt-1" style={{ color: "#94A3B8" }}>
                Retrieved chunks, similarity scores, and Claude&apos;s full response will appear here
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Avatar Layer ────────────────────────────────────────────── */}
      {tab === "avatar" && (
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="mb-6">
            <h2 className="text-base font-semibold" style={{ color: "#1E293B" }}>Avatar Layer</h2>
            <p className="text-sm mt-0.5" style={{ color: "#64748B" }}>
              Platform credentials for avatar creation and delivery. Keys are stored in the DB and override environment variables.
            </p>
          </div>

          <div className="grid gap-5">
            {([
              {
                id: "hedra" as AvatarProvider,
                label: "Hedra",
                badge: "Avatar Video",
                desc: "Generates lip-synced avatar video from a user photo in real-time.",
                accent: "#f97316",
                fields: [
                  { key: "newHedraKey",    set: newHedraKey,    setter: setNewHedraKey,    placeholder: "sk_hedra_…",  label: "API Key",    current: avatarSecrets?.hedraKey,    isSet: avatarSecrets?.hedraSet },
                  { key: "newHedraSecret", set: newHedraSecret, setter: setNewHedraSecret, placeholder: "Secret…",     label: "API Secret", current: avatarSecrets?.hedraSecret, isSet: avatarSecrets?.hedraSecretSet },
                ],
              },
              {
                id: "elevenlabs" as AvatarProvider,
                label: "ElevenLabs",
                badge: "Voice",
                desc: "Voice cloning and text-to-speech for the avatar.",
                accent: "#22d3ee",
                fields: [
                  { key: "newElevenlabsKey", set: newElevenlabsKey, setter: setNewElevenlabsKey, placeholder: "sk_…", label: "API Key", current: avatarSecrets?.elevenlabsKey, isSet: avatarSecrets?.elevenlabsSet },
                ],
              },
              {
                id: "stability" as AvatarProvider,
                label: "Stability AI",
                badge: "Stylization",
                desc: "Turns the user photo into a stylized avatar image.",
                accent: "#6366f1",
                fields: [
                  { key: "newStabilityKey", set: newStabilityKey, setter: setNewStabilityKey, placeholder: "sk-…", label: "API Key", current: avatarSecrets?.stabilityKey, isSet: avatarSecrets?.stabilitySet },
                ],
              },
              {
                id: "fal" as AvatarProvider,
                label: "Fal.AI",
                badge: "AI Generation",
                desc: "AI image and video generation for avatar customization.",
                accent: "#a78bfa",
                fields: [
                  { key: "newFalKey", set: newFalKey, setter: setNewFalKey, placeholder: "key_id:key_secret", label: "API Key", current: avatarSecrets?.falKey, isSet: avatarSecrets?.falSet },
                ],
              },
              {
                id: "livekit" as AvatarProvider,
                label: "LiveKit",
                badge: "Streaming",
                desc: "Real-time WebRTC transport for avatar video and audio.",
                accent: "#34d399",
                fields: [
                  { key: "newLivekitKey",    set: newLivekitKey,    setter: setNewLivekitKey,    placeholder: "API…",        label: "API Key",    current: avatarSecrets?.livekitKey,    isSet: !!avatarSecrets?.livekitKey },
                  { key: "newLivekitSecret", set: newLivekitSecret, setter: setNewLivekitSecret, placeholder: "Secret…",     label: "API Secret", current: avatarSecrets?.livekitSecret, isSet: !!avatarSecrets?.livekitSecret },
                  { key: "newLivekitUrl",    set: newLivekitUrl,    setter: setNewLivekitUrl,    placeholder: "wss://…",     label: "URL",        current: avatarSecrets?.livekitUrl,    isSet: !!avatarSecrets?.livekitUrl },
                ],
              },
            ]).map((svc) => (
              <div key={svc.id} className="rounded-2xl overflow-hidden"
                style={{ border: "1px solid rgba(0,0,0,0.08)", background: "#FFFFFF" }}>
                {/* Header row */}
                <div className="flex items-center justify-between px-5 pt-4 pb-3"
                  style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ background: svc.accent }}/>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold" style={{ color: "#1E293B" }}>{svc.label}</span>
                        <span className="text-xs px-2 py-0.5 rounded-md"
                          style={{ background: svc.accent + "18", color: svc.accent, border: `1px solid ${svc.accent}30` }}>
                          {svc.badge}
                        </span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: "#64748B" }}>{svc.desc}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <KeyStatusPill
                      status={avStatus[svc.id]}
                      isSet={svc.id === "livekit" ? !!avatarSecrets?.livekitSet : !!(svc.fields[0]?.isSet)}
                      latencyMs={avLatency[svc.id]}
                      error={avError[svc.id]}
                      onRetest={() => testAvatarKey(svc.id)}
                    />
                    {(svc.id === "livekit" ? avatarSecrets?.livekitSet : svc.fields[0]?.isSet) && (
                      <span className="text-xs" style={{ color: "#334155" }}>re-checks every 5 min</span>
                    )}
                  </div>
                </div>
                {/* Input fields */}
                <div className="px-5 py-4 space-y-3">
                  {svc.fields.map((f) => (
                    <div key={f.key}>
                      <p className="text-xs font-medium mb-1.5" style={{ color: "#64748B" }}>{f.label}</p>
                      {f.isSet && f.current && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-2"
                          style={{ background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.06)" }}>
                          <span className="text-xs" style={{ color: "#64748B" }}>Current:</span>
                          <span className="text-xs font-mono" style={{ color: "#9CA3AF" }}>{f.current}</span>
                        </div>
                      )}
                      <input
                        type={f.label === "URL" ? "text" : "password"}
                        value={f.set}
                        onChange={e => f.setter(e.target.value)}
                        placeholder={f.isSet ? `Paste new ${f.label.toLowerCase()} to replace…` : f.placeholder}
                        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none font-mono"
                        style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.1)", color: "#1E293B" }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Save */}
          <div className="flex justify-end mt-6">
            <button onClick={saveAvatarSecrets} disabled={avatarSaving}
              className="text-sm px-6 py-2.5 rounded-xl font-semibold transition-all"
              style={{
                background: avatarSaving ? "#F1F5F9" : "linear-gradient(135deg,#f97316,#ea580c)",
                color: avatarSaving ? "#94A3B8" : "#fff",
                border: "none",
                cursor: avatarSaving ? "not-allowed" : "pointer",
                boxShadow: avatarSaving ? "none" : "0 0 20px rgba(249,115,22,0.25)",
              }}>
              {avatarSaving ? "Saving…" : "Save Avatar Connections"}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Brain Map ────────────────────────────────────────────────── */}
      {tab === "map" && (
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="mb-6">
            <h2 className="text-base font-semibold" style={{ color: "#1E293B" }}>Brain Map</h2>
            <p className="text-sm mt-0.5" style={{ color: "#64748B" }}>
              Every message triggers a single prompt that combines all sources simultaneously.
              Claude synthesises one response from the full picture — there is no fallback chain.
            </p>
          </div>
          <NeuralNetViz docs={docs} totalChunks={totalChunks} secrets={secrets} />
        </div>
      )}

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl text-sm font-medium shadow-2xl"
          style={{
            background: toast.ok ? "#F0FDF4" : "#FEF2F2",
            border: `1px solid ${toast.ok ? "#86EFAC" : "#FECACA"}`,
            color: toast.ok ? "#166534" : "#991B1B",
            backdropFilter: "blur(12px)",
            whiteSpace: "nowrap",
          }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPill({ color, label, active }: { color: string; label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
      style={{ background: active ? `${color}15` : "rgba(0,0,0,0.03)", border: `1px solid ${active ? color + "30" : "rgba(0,0,0,0.08)"}` }}>
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: active ? color : "#CBD5E1", boxShadow: active ? `0 0 5px ${color}` : "none" }}/>
      <span className="text-xs" style={{ color: active ? color : "#94A3B8" }}>{label}</span>
    </div>
  );
}

function KeyStatusPill({ status, isSet, latencyMs, error, onRetest }: {
  status: KeyStatus;
  isSet: boolean;
  latencyMs: number | null;
  error: string | null;
  onRetest: () => void;
}) {
  if (!isSet) return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full flex-shrink-0"
      style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#f87171" }}/>
      <span className="text-xs" style={{ color: "#f87171" }}>Not set</span>
    </div>
  );

  const cfg: Record<KeyStatus, { color: string; bg: string; border: string; label: string }> = {
    idle:    { color: "#64748B", bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.2)",  label: "Checking…"  },
    testing: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.2)",   label: "Testing…"   },
    valid:   { color: "#34d399", bg: "rgba(52,211,153,0.1)",   border: "rgba(52,211,153,0.25)",  label: latencyMs ? `${latencyMs}ms` : "Connected" },
    invalid: { color: "#f87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.2)",  label: "Invalid key" },
  };
  const { color, bg, border, label } = cfg[status];

  return (
    <button onClick={onRetest} title={status === "invalid" ? (error ?? "Click to retry") : "Click to retest"}
      className="flex items-center gap-1.5 px-3 py-1 rounded-full flex-shrink-0 transition-opacity hover:opacity-75"
      style={{ background: bg, border: `1px solid ${border}`, cursor: "pointer" }}>
      {status === "testing"
        ? <Spinner color={color} />
        : <div className="w-1.5 h-1.5 rounded-full"
            style={{ background: color, boxShadow: status === "valid" ? `0 0 5px ${color}` : "none" }}/>
      }
      <span className="text-xs" style={{ color }}>{label}</span>
    </button>
  );
}

function Spinner({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" style={{ animation: "spin 0.8s linear infinite" }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10"/>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

// ── Neural Network Visualization ─────────────────────────────────────────────

function NeuralNetViz({
  docs,
  totalChunks,
  secrets,
}: {
  docs: MedicalDoc[];
  totalChunks: number;
  secrets: Secrets | null;
}) {
  const VW = 1300, VH = 540;

  // Left: inputs
  const LX = 165, IR = 27;
  const INY = [55, 130, 210, 290, 370, 450];

  // Center: Claude (generation)
  const CLX = 415, CLY = 265, CLR = 52;

  // Middle: Output (convergence of brain + avatar pipeline)
  const RX = 635, RY = 265, RR = 33;

  // Avatar pipeline — 3 right-hand stages flowing right → left into Output
  // Stage 1 (DELIVERY): LiveKit
  const LKX = 810, LKY = 265, LKR = 26;
  // Stage 2 (ASSEMBLY): Hedra
  const HX = 990, HY = 265, HR = 30;
  // Stage 3 (CREATION): Fal.AI · Stability AI · ElevenLabs
  const CRX = 1165, CRR = 24;
  const CRY = [115, 265, 415];

  // ── Node data ──────────────────────────────────────────────────────────────
  const sources = [
    { id: "config",    label: "Brain Config",   sub: "Persona · Style · Safety",                    color: "#f87171", icon: "⚙",  active: true,            r: IR,  planned: false },
    { id: "docs",      label: "Knowledge Base", sub: `${docs.length} docs · ${totalChunks} chunks`, color: "#a78bfa", icon: "◈",  active: totalChunks > 0, r: IR,  planned: false },
    { id: "health",    label: "HealthKit Data", sub: "HRV · Sleep · Steps",                         color: "#34d399", icon: "♥",  active: true,            r: IR,  planned: false },
    { id: "wearables", label: "Wearables",      sub: "Oura Ring · Whoop",                           color: "#2dd4bf", icon: "⌚", active: false,           r: IR,  planned: true  },
    { id: "memory",    label: "Session Memory", sub: "Past conversations",                           color: "#38bdf8", icon: "◉",  active: true,            r: IR,  planned: false },
    { id: "training",  label: "Claude Training",sub: "Medical · health · science",                  color: "#f59e0b", icon: "✦",  active: true,            r: IR,  planned: false },
  ];

  const creationNodes = [
    { id: "fal",        label: "Fal.AI",       sub: "Body avatar · flux-pulid", color: "#e879f9", icon: "✦" },
    { id: "stability",  label: "Stability AI", sub: "Face portrait stylize",    color: "#fb923c", icon: "◈" },
    { id: "elevenlabs", label: "ElevenLabs",   sub: "Voice clone · TTS",        color: "#22d3ee", icon: "♪" },
  ];

  const modelLabel = (m?: string | null) => {
    if (!m) return "Haiku";
    if (m.includes("opus"))   return "Opus";
    if (m.includes("sonnet")) return "Sonnet";
    return "Haiku";
  };

  // ── Path generators ────────────────────────────────────────────────────────
  // Left inputs → Claude
  const connPath = (srcY: number, srcR: number) => {
    const fx = LX + srcR, tx = CLX - CLR, cpx = (fx + tx) / 2;
    return `M ${fx},${srcY} C ${cpx},${srcY} ${cpx},${CLY} ${tx},${CLY}`;
  };

  // Creation node[i] → Hedra (right-to-left, converging)
  const connCreation = (i: number) => {
    const fx = CRX - CRR, fy = CRY[i], tx = HX + HR, ty = HY;
    const cpx = (fx + tx) / 2;
    const sameY = Math.abs(fy - ty) < 6;
    const cp1y = sameY ? fy - 30 : fy;
    const cp2y = sameY ? ty - 30 : ty;
    return `M ${fx},${fy} C ${cpx},${cp1y} ${cpx},${cp2y} ${tx},${ty}`;
  };

  // Hedra → LiveKit (same Y, bow upward)
  const connHedraToLK = `M ${HX - HR},${HY} C ${(HX-HR+LKX+LKR)/2},${HY-28} ${(HX-HR+LKX+LKR)/2},${LKY-28} ${LKX + LKR},${LKY}`;

  // LiveKit → Output (same Y, bow upward)
  const connLKToOut = `M ${LKX - LKR},${LKY} C ${(LKX-LKR+RX+RR)/2},${LKY-28} ${(LKX-LKR+RX+RR)/2},${RY-28} ${RX + RR},${RY}`;

  // Claude → Output
  const connClaudeOut = `M ${CLX + CLR},${CLY} C ${CLX+CLR+28},${CLY-18} ${RX-RR-28},${RY-18} ${RX - RR},${RY}`;

  // RAG filter gate (on the Knowledge Base path)
  const kbGateX = 248, kbGateY = 140;
  const gW = 74, gH = 38, gCut = 11;
  const hex = (cx: number, cy: number, w: number, h: number, cut: number) =>
    `${cx-w/2},${cy} ${cx-w/2+cut},${cy-h/2} ${cx+w/2-cut},${cy-h/2} ${cx+w/2},${cy} ${cx+w/2-cut},${cy+h/2} ${cx-w/2+cut},${cy+h/2}`;

  // Feedback arc: Output bottom → Session Memory (INY[4])
  const feedbackD = `M ${RX},${RY + RR + 4} C ${RX + 36},${VH - 18} ${340},${VH - 12} ${LX},${INY[4] + IR + 2}`;

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid rgba(0,0,0,0.08)", background: "rgba(4,4,20,0.8)" }}>
      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: "100%", display: "block" }}>
        <defs>
          <filter id="nnv-glow">
            <feGaussianBlur stdDeviation="4" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="nnv-glow-sm">
            <feGaussianBlur stdDeviation="2" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="nnv-rg-claude" cx="40%" cy="35%">
            <stop offset="0%"   stopColor="#a78bfa" stopOpacity="0.55"/>
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.38"/>
          </radialGradient>
          <radialGradient id="nnv-rg-out" cx="50%" cy="50%">
            <stop offset="0%"   stopColor="#34d399" stopOpacity="0.45"/>
            <stop offset="60%"  stopColor="#0f766e" stopOpacity="0.28"/>
            <stop offset="100%" stopColor="#f97316" stopOpacity="0.18"/>
          </radialGradient>
          <radialGradient id="nnv-rg-gate" cx="38%" cy="28%">
            <stop offset="0%"   stopColor="#4c1d95" stopOpacity="1"/>
            <stop offset="100%" stopColor="#08030f" stopOpacity="1"/>
          </radialGradient>
          <radialGradient id="nnv-rg-hedra" cx="40%" cy="35%">
            <stop offset="0%"   stopColor="#f97316" stopOpacity="0.5"/>
            <stop offset="100%" stopColor="#7c2d12" stopOpacity="0.3"/>
          </radialGradient>
          <radialGradient id="nnv-rg-lk" cx="40%" cy="35%">
            <stop offset="0%"   stopColor="#a3e635" stopOpacity="0.45"/>
            <stop offset="100%" stopColor="#1a2e05" stopOpacity="0.3"/>
          </radialGradient>
        </defs>

        {/* Background dots */}
        {Array.from({ length: 12 }, (_, c) =>
          Array.from({ length: 9 }, (_, r) => (
            <circle key={`bg-${c}-${r}`} cx={c * 112 + 14} cy={r * 65 + 14} r="1" fill="#fff" fillOpacity="0.025"/>
          ))
        )}

        {/* Stage dividers */}
        {[530, 720, 900, 1080].map(x => (
          <line key={x} x1={x} y1={28} x2={x} y2={VH - 28}
            stroke="#ffffff" strokeOpacity="0.03" strokeWidth="1" strokeDasharray="4 10"/>
        ))}

        {/* ── TRAIL LAYER ── */}

        {/* Inputs → Claude */}
        {sources.map((s, i) => (
          <path key={`trail-${i}`} d={connPath(INY[i], s.r)} fill="none"
            stroke={s.color} strokeWidth={s.planned ? "0.8" : "1.4"}
            strokeOpacity={s.planned ? 0.07 : 0.14}
            strokeDasharray={s.planned ? "3 8" : undefined}/>
        ))}

        {/* Claude → Output */}
        <path d={connClaudeOut} fill="none" stroke="#c4b5fd" strokeWidth="1.5" strokeOpacity="0.18"/>

        {/* Creation nodes → Hedra */}
        {creationNodes.map((s, i) => (
          <path key={`cr-trail-${i}`} d={connCreation(i)} fill="none"
            stroke={s.color} strokeWidth="1.4" strokeOpacity="0.14"/>
        ))}

        {/* Hedra → LiveKit */}
        <path d={connHedraToLK} fill="none" stroke="#f97316" strokeWidth="1.4" strokeOpacity="0.16"/>

        {/* LiveKit → Output */}
        <path d={connLKToOut} fill="none" stroke="#a3e635" strokeWidth="1.4" strokeOpacity="0.16"/>

        {/* Feedback arc */}
        <path d={feedbackD} fill="none"
          stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.08" strokeDasharray="3 8"/>

        {/* ── STREAMING LAYER ── */}

        {/* Inputs → Claude */}
        {sources.map((s, i) => {
          const d = connPath(INY[i], s.r);
          const dashLen = s.planned ? 5 : 12;
          const gap     = s.planned ? 24 : 36;
          const period  = dashLen + gap;
          return (
            <path key={`stream-${i}`} d={d} fill="none"
              stroke={s.color} strokeWidth="2.6" strokeLinecap="round"
              strokeDasharray={`${dashLen} ${gap}`}
              strokeOpacity={s.planned ? 0.38 : 0.92}
              filter="url(#nnv-glow-sm)">
              {/* @ts-ignore */}
              <animate attributeName="stroke-dashoffset"
                from="0" to={`-${period}`}
                dur={s.planned ? "3.0s" : `${1.05 + i * 0.12}s`}
                repeatCount="indefinite"/>
            </path>
          );
        })}

        {/* Claude → Output */}
        <path d={connClaudeOut} fill="none" stroke="#a78bfa" strokeWidth="2.6"
          strokeLinecap="round" strokeDasharray="12 36" strokeOpacity="0.92"
          filter="url(#nnv-glow-sm)">
          {/* @ts-ignore */}
          <animate attributeName="stroke-dashoffset" from="0" to="-48" dur="1.1s" repeatCount="indefinite"/>
        </path>

        {/* Creation → Hedra (right-to-left) */}
        {creationNodes.map((s, i) => (
          <path key={`cr-stream-${i}`} d={connCreation(i)} fill="none"
            stroke={s.color} strokeWidth="2.6" strokeLinecap="round"
            strokeDasharray="10 32" strokeOpacity="0.88"
            filter="url(#nnv-glow-sm)">
            {/* @ts-ignore */}
            <animate attributeName="stroke-dashoffset" from="0" to="-42"
              dur={`${1.1 + i * 0.2}s`} repeatCount="indefinite"/>
          </path>
        ))}

        {/* Hedra → LiveKit */}
        <path d={connHedraToLK} fill="none" stroke="#f97316" strokeWidth="2.6"
          strokeLinecap="round" strokeDasharray="12 36" strokeOpacity="0.92"
          filter="url(#nnv-glow-sm)">
          {/* @ts-ignore */}
          <animate attributeName="stroke-dashoffset" from="0" to="-48" dur="0.9s" repeatCount="indefinite"/>
        </path>

        {/* LiveKit → Output */}
        <path d={connLKToOut} fill="none" stroke="#a3e635" strokeWidth="2.6"
          strokeLinecap="round" strokeDasharray="12 36" strokeOpacity="0.92"
          filter="url(#nnv-glow-sm)">
          {/* @ts-ignore */}
          <animate attributeName="stroke-dashoffset" from="0" to="-48" dur="0.85s" repeatCount="indefinite"/>
        </path>

        {/* Feedback arc */}
        <path d={feedbackD} fill="none" stroke="#38bdf8" strokeWidth="1.8"
          strokeLinecap="round" strokeDasharray="8 22" strokeOpacity="0.58"
          filter="url(#nnv-glow-sm)">
          {/* @ts-ignore */}
          <animate attributeName="stroke-dashoffset" from="0" to="-30" dur="2.0s" repeatCount="indefinite"/>
        </path>
        <text x={310} y={VH - 10} textAnchor="middle" fontSize="8.5" fill="#38bdf8" fillOpacity="0.5">
          ↺ session summary saved after each reply — becomes next session&apos;s memory
        </text>

        {/* ── RAG gate (sits on top of streams) ── */}
        <g>
          <polygon points={hex(kbGateX, kbGateY, gW + 10, gH + 10, gCut + 3)} fill="#04010c"/>
          <polygon points={hex(kbGateX, kbGateY, gW + 12, gH + 10, gCut + 4)}
            fill="none" stroke="#a78bfa" strokeWidth="2" strokeOpacity="0.12" filter="url(#nnv-glow)">
            {/* @ts-ignore */}
            <animate attributeName="strokeOpacity" values="0.05;0.35;0.05" dur="2.6s" repeatCount="indefinite"/>
          </polygon>
          <polygon points={hex(kbGateX, kbGateY, gW, gH, gCut)}
            fill="url(#nnv-rg-gate)" stroke="#a78bfa" strokeWidth="1.4" strokeOpacity="0.85"/>
          <line x1={kbGateX - gW/2 + gCut + 6} y1={kbGateY - gH/2 + 5}
            x2={kbGateX + gW/2 - gCut - 6}     y2={kbGateY - gH/2 + 5}
            stroke="#c4b5fd" strokeWidth="0.7" strokeOpacity="0.4"/>
          <text x={kbGateX} y={kbGateY - 9} textAnchor="middle" fontSize="6.5" fontWeight="800"
            fill="#a78bfa" fillOpacity="0.9" letterSpacing="2">RAG FILTER</text>
          <text x={kbGateX} y={kbGateY + 7} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#e2d9ff">
            {`≥ ${(secrets?.ragThreshold ?? 0.25).toFixed(2)}`}
          </text>
          <rect x={kbGateX - 23} y={kbGateY + 12} width={46} height={4} rx="2"
            fill="rgba(167,139,250,0.12)" stroke="#a78bfa" strokeWidth="0.5" strokeOpacity="0.4"/>
          <rect x={kbGateX - 23} y={kbGateY + 12}
            width={46 * Math.min(secrets?.ragThreshold ?? 0.25, 1)}
            height={4} rx="2" fill="#a78bfa" fillOpacity="0.88"/>
        </g>

        {/* ── Section labels ── */}
        <text x={LX}  y={18} textAnchor="middle" fontSize="8" fill="#323248" fontWeight="600" letterSpacing="2">INPUTS</text>
        <text x={CLX} y={18} textAnchor="middle" fontSize="8" fill="#504070" fontWeight="600" letterSpacing="2">GENERATION</text>
        <text x={RX}  y={18} textAnchor="middle" fontSize="8" fill="#2d4a3e" fontWeight="600" letterSpacing="2">OUTPUT</text>
        <text x={LKX} y={18} textAnchor="middle" fontSize="8" fill="#2a3318" fontWeight="600" letterSpacing="2">DELIVERY</text>
        <text x={HX}  y={18} textAnchor="middle" fontSize="8" fill="#3d2010" fontWeight="600" letterSpacing="2">ASSEMBLY</text>
        <text x={CRX} y={18} textAnchor="middle" fontSize="8" fill="#2a1a3a" fontWeight="600" letterSpacing="2">CREATION</text>

        {/* ── Input nodes ── */}
        {sources.map((s, i) => (
          <g key={s.id}>
            <text x={LX - s.r - 11} y={INY[i] - 4} textAnchor="end" fontSize="11.5" fontWeight="600"
              fill={s.planned ? "#2a7a74" : (s.active ? "#ddddf0" : "#505060")}>
              {s.label}
            </text>
            <text x={LX - s.r - 11} y={INY[i] + 11} textAnchor="end" fontSize="9"
              fill={s.planned ? "#1e5550" : (s.active ? "#666" : "#383848")}>
              {s.sub}
            </text>
            {s.planned && (
              <text x={LX - s.r - 11} y={INY[i] + 24} textAnchor="end" fontSize="7" fill="#1a4040" letterSpacing="1">
                PLANNED
              </text>
            )}
            <circle cx={LX} cy={INY[i]} r={s.r}
              fill={s.color} fillOpacity={s.planned ? 0.07 : (s.active ? 0.14 : 0.05)}
              stroke={s.color} strokeWidth="1.5"
              strokeOpacity={s.planned ? 0.3 : (s.active ? 0.6 : 0.12)}
              strokeDasharray={s.planned ? "5 4" : undefined}/>
            <text x={LX} y={INY[i] + 5} textAnchor="middle" fontSize="14"
              fill={s.color} fillOpacity={s.planned ? 0.35 : (s.active ? 1 : 0.22)}>
              {s.icon}
            </text>
            {(s.active && !s.planned) && (
              <circle cx={LX + s.r - 5} cy={INY[i] - s.r + 5} r="3.5" fill={s.color} filter="url(#nnv-glow-sm)">
                {/* @ts-ignore */}
                <animate attributeName="opacity" values="1;0.2;1" dur="2.4s" repeatCount="indefinite"/>
              </circle>
            )}
          </g>
        ))}

        {/* ── Claude node ── */}
        <circle cx={CLX} cy={CLY} r={CLR + 12} fill="none" stroke="#7c3aed" strokeWidth="8" strokeOpacity="0.1" filter="url(#nnv-glow)">
          {/* @ts-ignore */}
          <animate attributeName="strokeOpacity" values="0.1;0.35;0.1" dur="2.8s" repeatCount="indefinite"/>
        </circle>
        <circle cx={CLX} cy={CLY} r={CLR}
          fill="url(#nnv-rg-claude)" stroke="#a78bfa" strokeWidth="1.5" strokeOpacity="0.8" filter="url(#nnv-glow)"/>
        <text x={CLX} y={CLY - 10} textAnchor="middle" fontSize="22" fill="#c4b5fd" filter="url(#nnv-glow)">◈</text>
        <text x={CLX} y={CLY + 13} textAnchor="middle" fontSize="13" fontWeight="700" fill="#e8e8f0">Claude</text>
        <text x={CLX} y={CLY + 30} textAnchor="middle" fontSize="10" fill="#a78bfa">{modelLabel(secrets?.primaryModel)}</text>

        {/* ── Output node ── */}
        <circle cx={RX} cy={RY} r={RR + 10} fill="none" stroke="#34d399" strokeWidth="7" strokeOpacity="0.08" filter="url(#nnv-glow)">
          {/* @ts-ignore */}
          <animate attributeName="strokeOpacity" values="0.06;0.28;0.06" dur="3.0s" repeatCount="indefinite"/>
        </circle>
        <circle cx={RX} cy={RY} r={RR}
          fill="url(#nnv-rg-out)" stroke="#34d399" strokeWidth="1.5" strokeOpacity="0.6" filter="url(#nnv-glow)"/>
        <text x={RX} y={RY - 5}  textAnchor="middle" fontSize="18" fill="#34d399">⊕</text>
        <text x={RX} y={RY + 13} textAnchor="middle" fontSize="11" fontWeight="600" fill="#d0d0e8">Output</text>
        <text x={RX} y={RY - RR - 12} textAnchor="middle" fontSize="8" fill="#34d399" fillOpacity="0.55">AI · Avatar · Voice</text>

        {/* ── LiveKit node (delivery) ── */}
        <circle cx={LKX} cy={LKY} r={LKR + 8} fill="none" stroke="#a3e635" strokeWidth="6" strokeOpacity="0.08" filter="url(#nnv-glow)">
          {/* @ts-ignore */}
          <animate attributeName="strokeOpacity" values="0.04;0.22;0.04" dur="2.5s" repeatCount="indefinite"/>
        </circle>
        <circle cx={LKX} cy={LKY} r={LKR}
          fill="url(#nnv-rg-lk)" stroke="#a3e635" strokeWidth="1.5" strokeOpacity="0.65" filter="url(#nnv-glow)"/>
        <text x={LKX} y={LKY + 5} textAnchor="middle" fontSize="16" fill="#a3e635">⬡</text>
        <text x={LKX} y={LKY + LKR + 16} textAnchor="middle" fontSize="11" fontWeight="600" fill="#ddddf0">LiveKit</text>
        <text x={LKX} y={LKY + LKR + 28} textAnchor="middle" fontSize="8.5" fill="#4a5e1a">WebRTC stream</text>
        <circle cx={LKX + LKR - 5} cy={LKY - LKR + 5} r="3.5" fill="#a3e635" filter="url(#nnv-glow-sm)">
          {/* @ts-ignore */}
          <animate attributeName="opacity" values="1;0.2;1" dur="2.1s" repeatCount="indefinite"/>
        </circle>

        {/* ── Hedra node (assembly) ── */}
        <circle cx={HX} cy={HY} r={HR + 9} fill="none" stroke="#f97316" strokeWidth="6" strokeOpacity="0.08" filter="url(#nnv-glow)">
          {/* @ts-ignore */}
          <animate attributeName="strokeOpacity" values="0.04;0.25;0.04" dur="2.3s" repeatCount="indefinite"/>
        </circle>
        <circle cx={HX} cy={HY} r={HR}
          fill="url(#nnv-rg-hedra)" stroke="#f97316" strokeWidth="1.5" strokeOpacity="0.7" filter="url(#nnv-glow)"/>
        <text x={HX} y={HY + 6} textAnchor="middle" fontSize="18" fill="#f97316">▶</text>
        <text x={HX} y={HY + HR + 16} textAnchor="middle" fontSize="11" fontWeight="600" fill="#ddddf0">Hedra</text>
        <text x={HX} y={HY + HR + 28} textAnchor="middle" fontSize="8.5" fill="#6b3010">Talking head</text>
        <circle cx={HX + HR - 5} cy={HY - HR + 5} r="3.5" fill="#f97316" filter="url(#nnv-glow-sm)">
          {/* @ts-ignore */}
          <animate attributeName="opacity" values="1;0.2;1" dur="1.9s" repeatCount="indefinite"/>
        </circle>

        {/* ── Creation nodes: Fal · Stability · ElevenLabs ── */}
        {creationNodes.map((s, i) => (
          <g key={s.id}>
            <text x={CRX + CRR + 12} y={CRY[i] - 4} textAnchor="start" fontSize="11.5" fontWeight="600" fill="#ddddf0">
              {s.label}
            </text>
            <text x={CRX + CRR + 12} y={CRY[i] + 11} textAnchor="start" fontSize="9" fill="#666">
              {s.sub}
            </text>
            <circle cx={CRX} cy={CRY[i]} r={CRR}
              fill={s.color} fillOpacity="0.14"
              stroke={s.color} strokeWidth="1.5" strokeOpacity="0.65"/>
            <text x={CRX} y={CRY[i] + 5} textAnchor="middle" fontSize="14" fill={s.color}>
              {s.icon}
            </text>
            <circle cx={CRX - CRR + 5} cy={CRY[i] - CRR + 5} r="3.5" fill={s.color} filter="url(#nnv-glow-sm)">
              {/* @ts-ignore */}
              <animate attributeName="opacity" values="1;0.2;1" dur={`${2.0 + i * 0.3}s`} repeatCount="indefinite"/>
            </circle>
          </g>
        ))}

      </svg>

      {/* Legend */}
      <div className="px-6 py-4 flex flex-wrap items-center justify-center gap-4"
        style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        {([
          { color: "#f87171", label: "Brain Config — always injected",            dim: false },
          { color: "#a78bfa", label: "Knowledge Base — if similarity ≥ threshold",dim: false },
          { color: "#34d399", label: "HealthKit — live biometric data",           dim: false },
          { color: "#2dd4bf", label: "Wearables — Oura · Whoop (planned)",        dim: true  },
          { color: "#38bdf8", label: "Session Memory — feedback loop",            dim: false },
          { color: "#f59e0b", label: "Claude Training — always available",        dim: false },
          { color: "#e879f9", label: "Fal.AI — body avatar generation",           dim: false },
          { color: "#fb923c", label: "Stability AI — face portrait stylize",      dim: false },
          { color: "#22d3ee", label: "ElevenLabs — voice clone · TTS",            dim: false },
          { color: "#f97316", label: "Hedra — talking head assembly",             dim: false },
          { color: "#a3e635", label: "LiveKit — WebRTC delivery",                 dim: false },
        ] as { color: string; label: string; dim: boolean }[]).map(item => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: item.color, opacity: item.dim ? 0.45 : 1 }}/>
            <span className="text-xs" style={{ color: item.dim ? "#2a5050" : "#555" }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
