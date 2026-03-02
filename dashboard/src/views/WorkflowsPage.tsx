"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useAppState } from "../stores";
import { Card } from "../components/ui/Card";
import { StatusDot } from "../components/ui/StatusDot";
import { api, createEventSource } from "../utils/api";
import { timeAgo, formatIST } from "../utils/formatters";

/* ─── Types ─── */
interface WorkflowStep {
  id: string;
  stepNumber: number;
  agentId: string;
  description: string;
  dependsOn: string[] | null;
  status: "pending" | "ready" | "running" | "completed" | "failed" | "skipped" | "cancelled";
  output?: string | null;
  taskId?: number | null;
  started_at?: string;
  completed_at?: string;
  error?: string | null;
}

interface WorkflowProgress {
  total: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
}

interface Workflow {
  id: string;
  name: string;
  description?: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  steps?: WorkflowStep[];
  progress?: WorkflowProgress;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

interface Checkpoint {
  id: string;
  workflow_id: string;
  step_id: string;
  task_id?: number;
  agent_id: string;
  description: string;
  risk_level: "low" | "medium" | "high" | "critical";
  status: "pending" | "approved" | "rejected" | "expired" | "auto_approved";
  requested_at: string;
  context?: Record<string, unknown>;
  workflow_name?: string;
  step_description?: string;
}

/* ─── Helpers ─── */
function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function calcDuration(startedAt?: string, completedAt?: string): string | null {
  if (!startedAt) return null;
  const end = completedAt ? new Date(completedAt) : new Date();
  const secs = Math.floor((end.getTime() - new Date(startedAt).getTime()) / 1000);
  return formatElapsed(secs);
}

/* ─── Colors ─── */
const RISK_COLORS: Record<string, string> = {
  low: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  high: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  critical: "text-red-400 bg-red-500/10 border-red-500/30",
};

const WF_STATUS_COLOR: Record<string, string> = {
  pending: "text-gray-400",
  running: "text-blue-400",
  paused: "text-yellow-400",
  completed: "text-emerald-400",
  failed: "text-red-400",
  cancelled: "text-gray-500",
};

const STEP_STYLE: Record<string, { border: string; bg: string; text: string; icon: string }> = {
  running:   { border: "border-blue-500/30",    bg: "bg-blue-500/8",    text: "text-blue-300",   icon: "●" },
  completed: { border: "border-emerald-500/20", bg: "bg-emerald-500/5", text: "text-emerald-400", icon: "✓" },
  failed:    { border: "border-red-500/25",     bg: "bg-red-500/8",     text: "text-red-400",    icon: "✗" },
  skipped:   { border: "border-white/[0.05]",   bg: "bg-white/[0.01]",  text: "text-gray-600",   icon: "⊘" },
  cancelled: { border: "border-white/[0.05]",   bg: "bg-white/[0.01]",  text: "text-gray-600",   icon: "⊘" },
  pending:   { border: "border-white/[0.06]",   bg: "bg-white/[0.02]",  text: "text-gray-500",   icon: "○" },
  ready:     { border: "border-white/[0.06]",   bg: "bg-white/[0.02]",  text: "text-gray-400",   icon: "○" },
};

/* ─── Step Detail Row ─── */
function StepRow({ step, agents }: { step: WorkflowStep; agents: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const agent = agents.find(a => a.id === step.agentId);
  const s = STEP_STYLE[step.status] || STEP_STYLE.pending;
  const hasOutput = step.output && step.output.trim().length > 0;

  return (
    <div className={`rounded-lg border ${s.border} ${s.bg} transition-colors`}>
      <div className="flex items-start gap-2.5 p-2.5">
        {/* Step number */}
        <span className="text-[10px] text-gray-600 font-mono w-4 pt-0.5 shrink-0">{step.stepNumber}</span>
        {/* Agent emoji */}
        <span className="text-base leading-none pt-0.5 shrink-0">{agent?.emoji || "🤖"}</span>
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-300 capitalize">{agent?.name || step.agentId}</span>
            <span className={`text-[10px] font-medium ${s.text} flex items-center gap-1`}>
              {step.status === "running" && <span className="animate-pulse">●</span>}
              {step.status !== "running" && s.icon}
              <span className="capitalize">{step.status}</span>
            </span>
            {step.started_at && step.completed_at && (
              <span className="text-[10px] text-gray-600 ml-auto">
                {calcDuration(step.started_at, step.completed_at)}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{step.description}</p>
          {/* Output preview */}
          {hasOutput && (
            <div className="mt-1.5">
              <button
                onClick={() => setExpanded(e => !e)}
                className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                {expanded ? "▲ hide output" : "▼ show output"}
              </button>
              {expanded && (
                <pre className="mt-1 text-[10px] text-gray-400 bg-black/30 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap leading-relaxed font-mono">
                  {step.output!.slice(0, 800)}{step.output!.length > 800 ? "…" : ""}
                </pre>
              )}
              {!expanded && (
                <p className="text-[10px] text-gray-600 font-mono mt-0.5 line-clamp-1">
                  {step.output!.slice(0, 100)}
                </p>
              )}
            </div>
          )}
          {step.error && (
            <p className="text-[10px] text-red-400 mt-1 bg-red-500/10 rounded px-1.5 py-1">{step.error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Progress Bar ─── */
function WorkflowProgressBar({ progress }: { progress: WorkflowProgress }) {
  const { total, completed, failed, running } = progress;
  if (total === 0) return null;
  const pctComplete = Math.round((completed / total) * 100);
  const pctFailed = Math.round((failed / total) * 100);
  const pctRunning = Math.round((running / total) * 100);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-gray-500">
        <span>{completed}/{total} steps</span>
        <span className="flex gap-2">
          {running > 0 && <span className="text-blue-400">{running} running</span>}
          {failed > 0 && <span className="text-red-400">{failed} failed</span>}
          <span>{pctComplete}%</span>
        </span>
      </div>
      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden flex">
        <div className="h-full bg-emerald-500/70 rounded-full transition-all duration-500" style={{ width: `${pctComplete}%` }} />
        <div className="h-full bg-blue-500/70 transition-all duration-500" style={{ width: `${pctRunning}%` }} />
        <div className="h-full bg-red-500/60 transition-all duration-500" style={{ width: `${pctFailed}%` }} />
      </div>
    </div>
  );
}

/* ─── Create Workflow Modal ─── */
function CreateWorkflowModal({ agents, onClose, onCreated }: { agents: any[]; onClose: () => void; onCreated: () => void }) {
  const [tab, setTab] = useState<"auto" | "manual">("auto");
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<{ agent_id: string; description: string }[]>([{ agent_id: "", description: "" }]);
  const [generatedSteps, setGeneratedSteps] = useState<any[] | null>(null);
  const [generatedId, setGeneratedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setLoading(true); setError("");
    try {
      const result = await api<any>("/workflows/from-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      setGeneratedSteps(result.steps || []);
      setGeneratedId(result.id);
    } catch (e: any) { setError(e?.message || "Failed to generate pipeline"); }
    setLoading(false);
  };

  const handleStart = async () => {
    if (!generatedId) return;
    setLoading(true);
    try {
      await api(`/workflows/${generatedId}/start`, { method: "POST" });
      onCreated(); onClose();
    } catch (e: any) { setError(e?.message || "Failed to start"); }
    setLoading(false);
  };

  const handleManualCreate = async () => {
    if (!name.trim() || steps.some(s => !s.agent_id || !s.description)) { setError("Fill in all fields"); return; }
    setLoading(true); setError("");
    try {
      const wf = await api<any>("/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, steps }),
      });
      await api(`/workflows/${wf.id}/start`, { method: "POST" });
      onCreated(); onClose();
    } catch (e: any) { setError(e?.message || "Failed to create"); }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-white/[0.08] bg-gray-950 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
          <h2 className="font-semibold text-base">Create Workflow</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="flex border-b border-white/[0.06]">
          {(["auto", "manual"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${tab === t ? "text-emerald-400 border-b-2 border-emerald-400" : "text-gray-500 hover:text-gray-300"}`}>
              {t === "auto" ? "🤖 Auto-generate" : "🔧 Manual"}
            </button>
          ))}
        </div>
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {tab === "auto" ? (
            <>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Describe what you want to accomplish</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. Research React 19 features, build a demo component, then run QA tests"
                  className="w-full h-24 px-3 py-2 bg-white/5 border border-white/[0.08] rounded-lg text-sm resize-none focus:outline-none focus:border-emerald-500/40" />
              </div>
              {!generatedSteps ? (
                <button onClick={handleGenerate} disabled={loading || !description.trim()}
                  className="w-full py-2.5 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-50">
                  {loading ? "Generating pipeline…" : "Generate Pipeline"}
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">Generated steps — review and start:</p>
                  {generatedSteps.map((s: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                      <span className="text-xs text-gray-600 font-mono pt-0.5 w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-300">{s.agentId}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>
                      </div>
                    </div>
                  ))}
                  <button onClick={handleStart} disabled={loading}
                    className="w-full py-2.5 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-50">
                    {loading ? "Starting…" : "▶ Start Workflow"}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Workflow name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="My workflow"
                  className="w-full px-3 py-2 bg-white/5 border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-emerald-500/40" />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-500">Steps</label>
                {steps.map((step, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <select value={step.agent_id}
                      onChange={e => setSteps(steps.map((s, j) => j === i ? { ...s, agent_id: e.target.value } : s))}
                      className="w-28 px-2 py-2 bg-white/5 border border-white/[0.08] rounded-lg text-xs focus:outline-none focus:border-emerald-500/40">
                      <option value="">Agent…</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
                    </select>
                    <input value={step.description}
                      onChange={e => setSteps(steps.map((s, j) => j === i ? { ...s, description: e.target.value } : s))}
                      placeholder={`Step ${i + 1} description`}
                      className="flex-1 px-2 py-2 bg-white/5 border border-white/[0.08] rounded-lg text-xs focus:outline-none focus:border-emerald-500/40" />
                    {steps.length > 1 && (
                      <button onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="text-gray-600 hover:text-red-400 text-lg leading-none pt-1">×</button>
                    )}
                  </div>
                ))}
                <button onClick={() => setSteps([...steps, { agent_id: "", description: "" }])}
                  className="text-xs text-emerald-400 hover:text-emerald-300">+ Add Step</button>
              </div>
              <button onClick={handleManualCreate} disabled={loading}
                className="w-full py-2.5 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-50">
                {loading ? "Creating…" : "Create & Start"}
              </button>
            </>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
export function WorkflowsPage() {
  const { agents } = useAppState();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [wfDetails, setWfDetails] = useState<Record<string, Workflow>>({});
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedWf, setExpandedWf] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<Record<string, number>>({});
  const esRef = useRef<EventSource | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [wfData, cpData] = await Promise.all([
        api<Workflow[]>("/workflows?limit=30").catch(() => []),
        api<Checkpoint[]>("/checkpoints?status=pending").catch(() => []),
      ]);
      const wfs = Array.isArray(wfData) ? wfData : [];
      setWorkflows(wfs);
      setCheckpoints(Array.isArray(cpData) ? cpData : []);

      // Fetch full details (steps + progress) for active workflows
      const activeIds = wfs.filter(w => w.status === "running" || w.status === "paused").map(w => w.id);
      if (activeIds.length > 0) {
        const results = await Promise.allSettled(activeIds.map(id => api<Workflow>(`/workflows/${id}`)));
        setWfDetails(prev => {
          const next = { ...prev };
          results.forEach((r, i) => {
            if (r.status === "fulfilled") next[activeIds[i]] = r.value;
          });
          return next;
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // SSE — instant refresh on workflow/checkpoint events
  useEffect(() => {
    const connect = () => {
      const es = createEventSource();
      if (!es) return;
      esRef.current = es;
      const refresh = () => fetchData();
      es.addEventListener("groot:workflow", refresh);
      es.addEventListener("groot:checkpoint", refresh);
      es.onerror = () => { es.close(); esRef.current = null; };
    };
    connect();
    return () => { esRef.current?.close(); };
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 15000);
    return () => clearInterval(id);
  }, [fetchData]);

  // Live elapsed timer for running workflows
  useEffect(() => {
    const id = setInterval(() => {
      const next: Record<string, number> = {};
      workflows.forEach(wf => {
        if ((wf.status === "running" || wf.status === "paused") && wf.started_at) {
          next[wf.id] = Math.floor((Date.now() - new Date(wf.started_at).getTime()) / 1000);
        }
      });
      setElapsed(next);
    }, 1000);
    return () => clearInterval(id);
  }, [workflows]);

  const handleCheckpoint = async (id: string, action: "approve" | "reject") => {
    setActionLoading(id + action);
    try { await api(`/checkpoints/${id}/${action}`, { method: "POST" }); await fetchData(); } catch {}
    setActionLoading(null);
  };

  const handleCancel = async (wfId: string) => {
    setActionLoading("cancel-" + wfId);
    try { await api(`/workflows/${wfId}/cancel`, { method: "POST" }); await fetchData(); } catch {}
    setActionLoading(null);
  };

  const handleDelete = async (wfId: string) => {
    setActionLoading("delete-" + wfId);
    try { await api(`/workflows/${wfId}`, { method: "DELETE" }); await fetchData(); } catch {}
    setActionLoading(null);
  };

  const activeWfs = workflows.filter(w => w.status === "running" || w.status === "paused");
  const pendingWfs = workflows.filter(w => w.status === "pending");
  const historyWfs = workflows.filter(w => !["running", "paused", "pending"].includes(w.status));

  // Stats
  const today = new Date().toISOString().slice(0, 10);
  const completedToday = workflows.filter(w => w.status === "completed" && w.completed_at?.startsWith(today)).length;
  const failedCount = workflows.filter(w => w.status === "failed").length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Workflows</h1>
          <p className="text-xs text-gray-500 mt-0.5">Multi-agent orchestration & approval gates</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2.5 min-h-[44px] bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-500/30 transition-colors">
          + New Workflow
        </button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total",     value: workflows.length,  icon: "🔀", color: "text-gray-200" },
          { label: "Running",   value: activeWfs.length,  icon: "▶",  color: "text-blue-400" },
          { label: "Done today",value: completedToday,    icon: "✓",  color: "text-emerald-400" },
          { label: "Failed",    value: failedCount,       icon: "✗",  color: "text-red-400" },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="glass-card p-3 text-center">
            <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{icon} {label}</p>
          </div>
        ))}
      </div>

      {/* Checkpoint Approval Queue */}
      {checkpoints.length > 0 && (
        <Card title={`Pending Approvals (${checkpoints.length})`} icon="⏳">
          <div className="space-y-3">
            {checkpoints.map(cp => (
              <div key={cp.id} className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide ${RISK_COLORS[cp.risk_level] || RISK_COLORS.medium}`}>
                        {cp.risk_level} risk
                      </span>
                      <span className="text-xs text-gray-500">Agent: <span className="text-gray-300">{cp.agent_id}</span></span>
                      {cp.workflow_name && <span className="text-[10px] text-gray-600 truncate">· {cp.workflow_name}</span>}
                    </div>
                    <p className="text-sm text-gray-200">{cp.description}</p>
                    <p className="text-xs text-gray-500 mt-1">Requested {timeAgo(cp.requested_at)}</p>
                  </div>
                </div>
                {cp.context && Object.keys(cp.context).length > 0 && (
                  <div className="text-[11px] font-mono bg-black/30 rounded p-2 text-gray-400 max-h-20 overflow-auto">
                    {JSON.stringify(cp.context, null, 2)}
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => handleCheckpoint(cp.id, "approve")} disabled={!!actionLoading}
                    className="flex-1 py-2 text-xs font-medium bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors disabled:opacity-50">
                    {actionLoading === cp.id + "approve" ? "Approving…" : "✓ Approve"}
                  </button>
                  <button onClick={() => handleCheckpoint(cp.id, "reject")} disabled={!!actionLoading}
                    className="flex-1 py-2 text-xs font-medium bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50">
                    {actionLoading === cp.id + "reject" ? "Rejecting…" : "✗ Reject"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Active Workflows — rich view with progress + step detail */}
      {activeWfs.length > 0 && (
        <Card title="Active Workflows" icon="▶️">
          <div className="space-y-4">
            {activeWfs.map(wf => {
              const detail = wfDetails[wf.id];
              const progress = detail?.progress;
              const steps = detail?.steps || [];
              const secs = elapsed[wf.id] || 0;

              return (
                <div key={wf.id} className="p-4 rounded-xl bg-white/[0.025] border border-blue-500/15 space-y-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusDot active={wf.status === "running"} />
                      <div className="min-w-0">
                        <p className="font-medium text-sm leading-tight truncate">{wf.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-xs font-medium ${WF_STATUS_COLOR[wf.status]}`}>{wf.status}</span>
                          {secs > 0 && (
                            <span className="text-xs text-blue-400/70 font-mono">
                              ⏱ {formatElapsed(secs)}
                            </span>
                          )}
                          {wf.started_at && (
                            <span className="text-xs text-gray-600">started {timeAgo(wf.started_at)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => handleCancel(wf.id)} disabled={actionLoading === "cancel-" + wf.id}
                        className="px-2.5 py-1 text-xs bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50">
                        {actionLoading === "cancel-" + wf.id ? "…" : "⏹ Cancel"}
                      </button>
                    </div>
                  </div>

                  {/* Progress bar */}
                  {progress && <WorkflowProgressBar progress={progress} />}

                  {/* Step rows */}
                  {steps.length > 0 && (
                    <div className="space-y-1.5">
                      {steps.map(step => (
                        <StepRow key={step.id} step={step} agents={agents} />
                      ))}
                    </div>
                  )}

                  {/* Error banner */}
                  {wf.error && (
                    <p className="text-xs text-red-400 bg-red-500/10 px-2 py-1.5 rounded">⚠ {wf.error}</p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Pending (not yet started) */}
      {pendingWfs.length > 0 && (
        <Card title={`Queued (${pendingWfs.length})`} icon="⏳">
          <div className="space-y-2">
            {pendingWfs.map(wf => (
              <div key={wf.id} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                <span className="text-xs text-gray-600">○</span>
                <span className="flex-1 text-sm text-gray-400">{wf.name}</span>
                <span className="text-xs text-gray-600">{timeAgo(wf.created_at)}</span>
                <button onClick={() => api(`/workflows/${wf.id}/start`, { method: "POST" }).then(fetchData)}
                  className="px-2.5 py-1 text-xs bg-emerald-500/15 text-emerald-400 rounded-lg hover:bg-emerald-500/25 transition-colors">
                  ▶ Start
                </button>
                <button onClick={() => handleDelete(wf.id)} disabled={actionLoading === "delete-" + wf.id}
                  className="px-2 py-1 text-xs text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                  {actionLoading === "delete-" + wf.id ? "…" : "🗑"}
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Empty state */}
      {!loading && activeWfs.length === 0 && pendingWfs.length === 0 && checkpoints.length === 0 && historyWfs.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="text-4xl">🔀</span>
          <p className="text-gray-400 text-sm">No workflows yet</p>
          <p className="text-gray-600 text-xs">Create a workflow to orchestrate multiple agents in sequence</p>
          <button onClick={() => setShowCreate(true)}
            className="mt-2 px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm hover:bg-emerald-500/30 transition-colors">
            Create First Workflow
          </button>
        </div>
      )}

      {/* Workflow History */}
      {historyWfs.length > 0 && (
        <Card title="History" icon="📋">
          <div className="space-y-1.5">
            {historyWfs.map(wf => {
              const isExpanded = expandedWf === wf.id;
              const duration = calcDuration(wf.started_at, wf.completed_at);
              const stepsFromDetail = wfDetails[wf.id]?.steps;

              // On expand, fetch detail if not already loaded
              const handleExpand = async () => {
                if (!isExpanded && !wfDetails[wf.id]) {
                  try {
                    const d = await api<Workflow>(`/workflows/${wf.id}`);
                    setWfDetails(prev => ({ ...prev, [wf.id]: d }));
                  } catch {}
                }
                setExpandedWf(isExpanded ? null : wf.id);
              };

              return (
                <div key={wf.id} className="rounded-lg border border-white/[0.04] overflow-hidden">
                  <div className="flex items-center">
                    <button onClick={handleExpand}
                      className="flex-1 flex items-center gap-3 p-3 text-left hover:bg-white/[0.02] transition-colors">
                      {/* Status icon */}
                      <span className={`text-xs font-medium w-3 ${WF_STATUS_COLOR[wf.status]}`}>
                        {wf.status === "completed" ? "✓" : wf.status === "failed" ? "✗" : wf.status === "cancelled" ? "⊘" : "○"}
                      </span>
                      <span className="flex-1 text-sm font-medium truncate">{wf.name}</span>
                      {/* Duration */}
                      {duration && (
                        <span className="text-[10px] text-gray-600 font-mono shrink-0">{duration}</span>
                      )}
                      {/* Step count */}
                      <span className="text-xs text-gray-500 shrink-0">{wf.steps?.length || "?"} steps</span>
                      <span className="text-xs text-gray-600 shrink-0">{timeAgo(wf.created_at)}</span>
                      <span className="text-gray-600 text-xs ml-1">{isExpanded ? "▲" : "▼"}</span>
                    </button>
                    <button onClick={e => { e.stopPropagation(); handleDelete(wf.id); }}
                      disabled={actionLoading === "delete-" + wf.id}
                      title="Delete workflow"
                      className="px-2.5 py-1 mr-2 text-xs text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50 min-h-[32px]">
                      {actionLoading === "delete-" + wf.id ? "…" : "🗑"}
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2 border-t border-white/[0.04] pt-3">
                      {/* Step detail for history */}
                      {stepsFromDetail && stepsFromDetail.length > 0 ? (
                        <div className="space-y-1.5">
                          {stepsFromDetail.map(step => (
                            <StepRow key={step.id} step={step} agents={agents} />
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-600">Loading steps…</p>
                      )}
                      {wf.error && (
                        <p className="text-xs text-red-400 bg-red-500/10 px-2 py-1.5 rounded">⚠ {wf.error}</p>
                      )}
                      {wf.completed_at && (
                        <p className="text-xs text-gray-600">Completed: {formatIST(wf.completed_at)}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateWorkflowModal agents={agents} onClose={() => setShowCreate(false)} onCreated={fetchData} />
      )}
    </div>
  );
}
