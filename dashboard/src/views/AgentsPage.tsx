"use client";
import { useState, useEffect } from "react";
import { useAppState, useAppActions } from "../stores";
import { Card } from "../components/ui/Card";
import { Badge, ModelBadge } from "../components/ui/Badge";
import { StatusDot } from "../components/ui/StatusDot";
import { Skeleton } from "../components/ui/Skeleton";
import { timeAgo } from "../utils/formatters";
import type { Task, AgentSkill, SkillLogEntry, AgentUsageSummary, AgentUsageEntry } from "../types";
import { api } from "../utils/api";
import { formatTokens, formatCost, formatDuration } from "../utils/formatters";

const MODEL_OPTIONS = [
  { value: "opus", label: "Claude Opus 4" },
  { value: "sonnet", label: "Claude Sonnet 4" },
  { value: "haiku", label: "Claude Haiku 3" },
  { value: "gpt-5.2", label: "OpenAI GPT-5.2" },
];

const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string; bar: string }> = {
  beginner:     { bg: "bg-gray-500/15",   text: "text-gray-400",   border: "border-gray-500/30",   bar: "bg-gray-500" },
  intermediate: { bg: "bg-blue-500/15",   text: "text-blue-400",   border: "border-blue-500/30",   bar: "bg-blue-500" },
  advanced:     { bg: "bg-purple-500/15", text: "text-purple-400", border: "border-purple-500/30", bar: "bg-purple-500" },
  expert:       { bg: "bg-amber-500/15",  text: "text-amber-400",  border: "border-amber-500/30",  bar: "bg-amber-500" },
};

const LEVEL_THRESHOLDS: Record<string, { min: number; max: number }> = {
  beginner:     { min: 0, max: 99 },
  intermediate: { min: 100, max: 499 },
  advanced:     { min: 500, max: 1499 },
  expert:       { min: 1500, max: 3000 },
};

function xpProgress(level: string, xp: number): number {
  const t = LEVEL_THRESHOLDS[level] || LEVEL_THRESHOLDS.beginner;
  const range = t.max - t.min + 1;
  const progress = xp - t.min;
  return Math.min(100, Math.max(0, (progress / range) * 100));
}

function SkillLevelBadge({ level }: { level: string }) {
  const c = LEVEL_COLORS[level] || LEVEL_COLORS.beginner;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c.bg} ${c.text}`}>
      {level}
    </span>
  );
}

function SkillCard({ skill, index }: { skill: AgentSkill; index: number }) {
  const c = LEVEL_COLORS[skill.level] || LEVEL_COLORS.beginner;
  const progress = xpProgress(skill.level, skill.xp);
  return (
    <div
      className={`glass-card p-3 border ${c.border} transition-all`}
      style={{ animation: `fadeIn 0.3s ease ${index * 0.05}s both` }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium truncate">{skill.skill}</span>
        <SkillLevelBadge level={skill.level} />
      </div>
      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mb-2">
        <div className={`h-full rounded-full ${c.bar} transition-all`} style={{ width: `${progress}%` }} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-gray-500">
        <span>{skill.xp} XP · {skill.times_used}× used</span>
        {skill.last_used && <span>{timeAgo(skill.last_used)}</span>}
      </div>
    </div>
  );
}

function SkillTimeline({ logs }: { logs: SkillLogEntry[] }) {
  const [open, setOpen] = useState(false);
  if (logs.length === 0) return null;

  const icon = (action: string) => {
    if (action === 'acquired') return '🆕';
    if (action === 'leveled_up') return '⬆️';
    return '🔧';
  };

  const desc = (l: SkillLogEntry) => {
    if (l.action === 'acquired') return `Acquired ${l.skill} (${l.new_level})`;
    if (l.action === 'leveled_up') return `Leveled up ${l.skill}: ${l.old_level} → ${l.new_level}`;
    return `Used ${l.skill}${l.task_id ? ` on task #${l.task_id}` : ''} (+${l.xp_gained} XP)`;
  };

  return (
    <div className="glass-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 min-h-[44px]"
      >
        <span className="font-semibold text-sm">📈 Skill Evolution</span>
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-0">
          {logs.map((l) => (
            <div key={l.id} className="flex items-start gap-3 py-2 border-l-2 border-white/10 pl-3 ml-1">
              <span className="text-sm shrink-0">{icon(l.action)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-300">{desc(l)}</p>
                <p className="text-[10px] text-gray-600">{l.logged_at ? timeAgo(l.logged_at) : ''}</p>
              </div>
              {l.action === 'leveled_up' && l.new_level && <SkillLevelBadge level={l.new_level} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopSkillPills({ skills }: { skills: AgentSkill[] }) {
  const top = skills.slice(0, 3);
  if (top.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {top.map(s => {
        const c = LEVEL_COLORS[s.level] || LEVEL_COLORS.beginner;
        return (
          <span key={s.id} className={`text-[9px] px-1.5 py-0.5 rounded-full border ${c.border} ${c.text}`}>
            {s.skill}
          </span>
        );
      })}
    </div>
  );
}

function SavedToast({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="text-emerald-400 text-xs font-medium animate-pulse">Saved ✓</span>
  );
}

function ModelConfigCard({ agentId, currentModel, onModelSaved }: { agentId: string; currentModel: string; onModelSaved: (m: string) => void }) {
  const [model, setModel] = useState(currentModel || "opus");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setModel(currentModel || "opus"); }, [currentModel]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api(`/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      setSaved(true);
      onModelSaved(model);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  const changed = model !== (currentModel || "opus");

  return (
    <div className="glass-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span>⚙️</span>
        <h3 className="font-semibold text-sm">Model</h3>
        <SavedToast show={saved} />
      </div>
      <div className="flex items-center gap-3">
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          className="flex-1 bg-white/5 border border-white/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/40 min-h-[44px]"
        >
          {MODEL_OPTIONS.map(o => (
            <option key={o.value} value={o.value} className="bg-gray-900">{o.value} — {o.label}</option>
          ))}
        </select>
        <button
          onClick={handleSave}
          disabled={saving || !changed}
          className="px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-40 min-h-[44px] shrink-0"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function InstructionsEditorCard({ agentId }: { agentId: string }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [readonly, setReadonly] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    setLoading(true);
    api<{ content: string; readonly?: boolean; note?: string }>(`/agents/${agentId}/instructions`)
      .then(res => {
        setContent(res.content || "");
        setReadonly(!!res.readonly);
        setNote(res.note || "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api(`/agents/${agentId}/instructions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  return (
    <div className="glass-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span>📝</span>
        <h3 className="font-semibold text-sm">Instructions (CLAUDE.md)</h3>
        <SavedToast show={saved} />
      </div>
      {loading ? (
        <Skeleton className="h-[200px] sm:h-[300px]" />
      ) : readonly ? (
        <p className="text-xs text-gray-500 py-4 text-center">{note || "Read-only"}</p>
      ) : (
        <>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            className="w-full min-h-[200px] sm:min-h-[300px] bg-white/5 border border-white/[0.08] rounded-lg p-3 font-mono text-sm text-gray-300 focus:outline-none focus:border-emerald-500/40 resize-y"
            placeholder="# Agent Instructions&#10;&#10;Write CLAUDE.md content here..."
          />
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-40 min-h-[44px]"
            >
              {saving ? "Saving..." : "Save Instructions"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function AgentsPage() {
  const { agents, tasks, agentsLoading } = useAppState();
  const { fetchAll } = useAppActions();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showCreateTask, setShowCreateTask] = useState<string | null>(null);
  const [taskDesc, setTaskDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [agentSkills, setAgentSkills] = useState<Record<string, AgentSkill[]>>({});
  const [skillLogs, setSkillLogs] = useState<SkillLogEntry[]>([]);
  const [usageSummary, setUsageSummary] = useState<AgentUsageSummary | null>(null);
  const [usageHistory, setUsageHistory] = useState<AgentUsageEntry[]>([]);
  const [performanceData, setPerformanceData] = useState<any | null>(null);
  const [memoryNamespaces, setMemoryNamespaces] = useState<any[] | null>(null);
  const [memoryExpanded, setMemoryExpanded] = useState<string | null>(null);
  const [memoryKeys, setMemoryKeys] = useState<Record<string, any[]>>({});
  const [memorySearch, setMemorySearch] = useState("");
  const [memorySearchResults, setMemorySearchResults] = useState<any[] | null>(null);

  // Fetch skills for all agents (for pills on cards)
  useEffect(() => {
    if (agents.length === 0) return;
    Promise.all(
      agents.map(a =>
        api<AgentSkill[]>(`/agents/${a.id}/skills`).catch(() => [] as AgentSkill[])
      )
    ).then(results => {
      const map: Record<string, AgentSkill[]> = {};
      agents.forEach((a, i) => { map[a.id] = results[i]; });
      setAgentSkills(map);
    });
  }, [agents]);

  // Fetch skill log when agent selected
  useEffect(() => {
    if (!selectedAgent) { setSkillLogs([]); return; }
    api<SkillLogEntry[]>(`/agents/${selectedAgent}/skill-log`).then(setSkillLogs).catch(() => setSkillLogs([]));
  }, [selectedAgent]);

  // Fetch usage data when agent selected
  useEffect(() => {
    if (!selectedAgent) { setUsageSummary(null); setUsageHistory([]); return; }
    api<AgentUsageSummary>(`/agents/${selectedAgent}/usage/summary`).then(setUsageSummary).catch(() => setUsageSummary(null));
    api<AgentUsageEntry[]>(`/agents/${selectedAgent}/usage?limit=20`).then(setUsageHistory).catch(() => setUsageHistory([]));
  }, [selectedAgent]);

  // Fetch performance data when agent selected
  useEffect(() => {
    if (!selectedAgent) { setPerformanceData(null); return; }
    api<any>(`/performance/${selectedAgent}`).then(setPerformanceData).catch(() => setPerformanceData(null));
  }, [selectedAgent]);

  // Fetch memory namespaces (once, for the global memory explorer)
  useEffect(() => {
    api<any[]>("/memory").then(setMemoryNamespaces).catch(() => setMemoryNamespaces([]));
  }, []);

  const handleMemoryNs = (ns: string) => {
    if (memoryExpanded === ns) { setMemoryExpanded(null); return; }
    setMemoryExpanded(ns);
    if (!memoryKeys[ns]) {
      api<any[]>(`/memory/${ns}`).then(keys => setMemoryKeys(k => ({ ...k, [ns]: keys }))).catch(() => {});
    }
  };

  const handleMemorySearch = () => {
    if (!memorySearch.trim()) { setMemorySearchResults(null); return; }
    api<any[]>(`/memory-search?q=${encodeURIComponent(memorySearch)}`).then(setMemorySearchResults).catch(() => setMemorySearchResults([]));
  };

  if (agentsLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-44" />)}
        </div>
      </div>
    );
  }

  const agentTasks = (agentId: string) => tasks.filter(t => t.agentId === agentId);
  const agent = selectedAgent ? agents.find(a => a.id === selectedAgent) : null;

  const handleCreateTask = async () => {
    if (!showCreateTask || !taskDesc.trim()) return;
    setCreating(true);
    try {
      await api("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: showCreateTask, description: taskDesc.trim() }),
      });
      setTaskDesc("");
      setShowCreateTask(null);
      await fetchAll();
    } catch {}
    setCreating(false);
  };

  if (agent) {
    const at = agentTasks(agent.id);
    const completed = at.filter(t => t.status === "done").length;
    const failed = at.filter(t => t.status === "failed").length;
    const successRate = at.length > 0 ? Math.round((completed / at.length) * 100) : 0;
    const skills = agentSkills[agent.id] || [];

    return (
      <div className="space-y-4">
        <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        <button onClick={() => setSelectedAgent(null)} className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1">
          ← Back to Agents
        </button>
        <div className="glass-card flex flex-col sm:flex-row items-start gap-4">
          <span className="text-5xl">{agent.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-xl font-bold">{agent.name}</h2>
              <StatusDot active={agent.status === "running" || agent.status === "working"} />
              <Badge status={agent.status} />
            </div>
            {agent.model && <ModelBadge model={agent.model} />}
            {agent.updatedAt && <p className="text-xs text-gray-500 mt-2">Last active: {timeAgo(agent.updatedAt)}</p>}
          </div>
          <button
            onClick={() => setShowCreateTask(agent.id)}
            className="px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-500/30 transition-colors shrink-0"
          >
            ➕ Assign Task
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="glass-card text-center py-3 overflow-hidden min-w-0">
            <div className="text-xl sm:text-2xl font-bold">{at.length}</div>
            <div className="text-xs text-gray-500">Total Tasks</div>
          </div>
          <div className="glass-card text-center py-3 overflow-hidden min-w-0">
            <div className="text-xl sm:text-2xl font-bold text-emerald-400">{successRate}%</div>
            <div className="text-xs text-gray-500">Success Rate</div>
          </div>
          <div className="glass-card text-center py-3 overflow-hidden min-w-0">
            <div className="text-xl sm:text-2xl font-bold text-red-400">{failed}</div>
            <div className="text-xs text-gray-500">Failed</div>
          </div>
        </div>

        {/* Usage & Cost */}
        {usageSummary && usageSummary.taskCount > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="glass-card text-center py-3">
                <div className="text-lg font-bold text-blue-400">{formatTokens(usageSummary.totalTokens)}</div>
                <div className="text-[10px] text-gray-500">Total Tokens</div>
              </div>
              <div className="glass-card text-center py-3">
                <div className="text-lg font-bold text-emerald-400">{formatCost(usageSummary.totalCost)}</div>
                <div className="text-[10px] text-gray-500">Total Cost</div>
              </div>
              <div className="glass-card text-center py-3">
                <div className="text-lg font-bold">{usageSummary.taskCount}</div>
                <div className="text-[10px] text-gray-500">Tasks Run</div>
              </div>
              <div className="glass-card text-center py-3">
                <div className="text-lg font-bold text-purple-400">{formatCost(usageSummary.avgCostPerTask)}</div>
                <div className="text-[10px] text-gray-500">Avg Cost/Task</div>
              </div>
            </div>

            {/* Cost by Model */}
            {Object.keys(usageSummary.byModel).length > 0 && (
              <div className="glass-card p-4">
                <h3 className="text-sm font-semibold mb-2">💰 Cost by Model</h3>
                <div className="space-y-2">
                  {Object.entries(usageSummary.byModel).map(([model, data]) => (
                    <div key={model} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-gray-400">{model}</span>
                      <span className="text-gray-300">{formatTokens(data.tokens)} tokens · {formatCost(data.cost)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Usage History */}
            {usageHistory.length > 0 && (
              <div className="glass-card p-4">
                <h3 className="text-sm font-semibold mb-3">📊 Recent Usage</h3>
                <div className="space-y-2">
                  {usageHistory.map(u => (
                    <div key={u.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-xs">
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-300 truncate">{u.task_description || u.session_key?.split(':').pop() || 'Task'}</p>
                        <p className="text-[10px] text-gray-600">{u.model} · {formatDuration(u.duration_ms)}</p>
                      </div>
                      <div className="flex items-center gap-3 text-gray-400 shrink-0">
                        <span>{formatTokens(u.total_tokens)}</span>
                        <span className="text-emerald-400 font-medium">{formatCost(u.cost_usd)}</span>
                        <span className="text-gray-600 text-[10px]">{timeAgo(u.recorded_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Performance Analytics */}
        {performanceData && (performanceData.total > 0 || performanceData.byTaskType?.length > 0) && (
          <div className="glass-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">📈 Performance</h3>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <div className="text-lg font-bold text-emerald-400">{performanceData.successRate ?? 0}%</div>
                <div className="text-[10px] text-gray-500">Success</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-yellow-400">{performanceData.partialRate ?? 0}%</div>
                <div className="text-[10px] text-gray-500">Partial</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-red-400">{performanceData.failedRate ?? 0}%</div>
                <div className="text-[10px] text-gray-500">Failed</div>
              </div>
            </div>
            {performanceData.avgDurationMs > 0 && (
              <p className="text-xs text-gray-500">Avg duration: <span className="text-gray-300">{formatDuration(performanceData.avgDurationMs)}</span></p>
            )}
            {performanceData.byTaskType && performanceData.byTaskType.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-white/5">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide">By Task Type</p>
                {performanceData.byTaskType.map((t: any) => (
                  <div key={t.task_type} className="flex justify-between text-xs py-1 border-b border-white/[0.03]">
                    <span className="text-gray-400">{t.task_type || "general"}</span>
                    <span className="text-gray-300">{t.success ?? 0}✓ {t.failed ?? 0}✗ · avg {formatDuration(t.avg_duration ?? 0)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Model Configuration */}
        <ModelConfigCard
          agentId={agent.id}
          currentModel={agent.model || "opus"}
          onModelSaved={(m) => fetchAll()}
        />

        {/* Instructions Editor */}
        <InstructionsEditorCard agentId={agent.id} />

        {/* Skills Section */}
        {skills.length > 0 && (
          <Card title="🎯 Skills & Expertise" icon="">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {skills.map((s, i) => <SkillCard key={s.id} skill={s} index={i} />)}
            </div>
          </Card>
        )}

        {/* Skill Evolution Timeline */}
        <SkillTimeline logs={skillLogs} />

        {/* Shared Memory Explorer */}
        {memoryNamespaces && memoryNamespaces.length > 0 && (
          <div className="glass-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">🧠 Shared Memory</h3>
              <div className="flex items-center gap-2">
                <input
                  value={memorySearch}
                  onChange={e => setMemorySearch(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleMemorySearch()}
                  placeholder="Search memory…"
                  className="text-xs px-2 py-1 bg-white/5 border border-white/[0.08] rounded-lg focus:outline-none focus:border-emerald-500/40 w-32"
                />
                <button onClick={handleMemorySearch} className="text-xs px-2 py-1 bg-white/5 rounded-lg hover:bg-white/10">🔍</button>
              </div>
            </div>
            {memorySearchResults ? (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-500">{memorySearchResults.length} results</p>
                {memorySearchResults.map((r: any) => (
                  <div key={r.id} className="p-2 rounded bg-white/[0.03] border border-white/[0.05] text-xs">
                    <span className="text-gray-500">{r.namespace}/{r.key}</span>
                    <p className="text-gray-300 truncate mt-0.5">{typeof r.value === "string" ? r.value : JSON.stringify(r.value)}</p>
                  </div>
                ))}
                <button onClick={() => { setMemorySearchResults(null); setMemorySearch(""); }} className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
              </div>
            ) : (
              <div className="space-y-1">
                {memoryNamespaces.slice(0, 8).map((ns: any) => (
                  <div key={ns.namespace}>
                    <button
                      onClick={() => handleMemoryNs(ns.namespace)}
                      className="w-full flex items-center justify-between py-1.5 text-xs text-left hover:text-white transition-colors"
                    >
                      <span className="text-gray-400 font-mono">{ns.namespace}</span>
                      <span className="text-gray-600">{ns.count} keys {memoryExpanded === ns.namespace ? "▲" : "▼"}</span>
                    </button>
                    {memoryExpanded === ns.namespace && memoryKeys[ns.namespace] && (
                      <div className="ml-2 space-y-1 pb-2">
                        {memoryKeys[ns.namespace].slice(0, 10).map((k: any) => (
                          <div key={k.key} className="flex gap-2 text-[11px] py-1 border-b border-white/[0.03]">
                            <span className="text-gray-500 shrink-0 w-24 truncate">{k.key}</span>
                            <span className="text-gray-400 flex-1 truncate">{typeof k.value === "string" ? k.value : JSON.stringify(k.value)}</span>
                            <span className="text-gray-600 shrink-0">{k.written_by}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <Card title="Task History" icon="📋">
          {at.length === 0 ? (
            <p className="text-gray-500 text-sm py-6 text-center">No tasks yet</p>
          ) : (
            <div className="space-y-1">
              {at.map(t => <TaskRow key={t.id} task={t} />)}
            </div>
          )}
        </Card>
        {showCreateTask && <CreateTaskModal agents={agents} selectedAgent={showCreateTask} taskDesc={taskDesc} setTaskDesc={setTaskDesc} creating={creating} onClose={() => setShowCreateTask(null)} onCreate={handleCreateTask} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{agents.length} Agents</h2>
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
          <button onClick={() => setViewMode("grid")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === "grid" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}>⊞ Grid</button>
          <button onClick={() => setViewMode("list")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === "list" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}>☰ List</button>
        </div>
      </div>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {agents.map(a => {
            const at = agentTasks(a.id);
            const completed = at.filter(t => t.status === "done").length;
            return (
              <div key={a.id} className="glass-card hover:border-emerald-500/20 transition-all cursor-pointer min-h-[44px] active:scale-[0.98]" onClick={() => setSelectedAgent(a.id)}>
                <div className="flex items-start justify-between mb-3">
                  <span className="text-3xl">{a.emoji}</span>
                  <StatusDot active={a.status === "running" || a.status === "working"} />
                </div>
                <h3 className="font-semibold text-sm mb-1">{a.name}</h3>
                <div className="flex items-center gap-2 mb-1">
                  {a.model && <ModelBadge model={a.model} />}
                  <Badge status={a.status} size="xs" />
                </div>
                {a.model && <p className="text-[10px] text-gray-500 mb-1">{a.model}</p>}
                {a.lastTask && <p className="text-xs text-gray-400 line-clamp-2 mb-2">{a.lastTask}</p>}
                <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                  <span>{at.length} tasks · {completed} ✓</span>
                  {a.updatedAt && <span>{timeAgo(a.updatedAt)}</span>}
                </div>
                <TopSkillPills skills={agentSkills[a.id] || []} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map(a => {
            const at = agentTasks(a.id);
            const skills = agentSkills[a.id] || [];
            const topNames = skills.slice(0, 3).map(s => s.skill).join(' · ');
            return (
              <div key={a.id} onClick={() => setSelectedAgent(a.id)} className="glass-card flex items-center gap-3 py-3 px-3 cursor-pointer hover:border-emerald-500/20 transition-all min-h-[44px]">
                <span className="text-xl shrink-0">{a.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{a.name}</span>
                    {a.model && <ModelBadge model={a.model} />}
                    {a.model && <span className="text-[10px] text-gray-500">{a.model}</span>}
                  </div>
                  {a.lastTask && <p className="text-xs text-gray-500 truncate mt-0.5">{a.lastTask}</p>}
                  {topNames && <p className="text-[10px] text-gray-600 mt-0.5">{topNames}</p>}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge status={a.status} size="xs" />
                  <span className="text-xs text-gray-500">{at.length} tasks</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreateTask && <CreateTaskModal agents={agents} selectedAgent={showCreateTask} taskDesc={taskDesc} setTaskDesc={setTaskDesc} creating={creating} onClose={() => setShowCreateTask(null)} onCreate={handleCreateTask} />}
    </div>
  );
}

function TaskRow({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button onClick={() => setExpanded(!expanded)} className="w-full text-left flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/[0.03] transition-colors">
      <span className="text-xs text-gray-600 mt-0.5 font-mono shrink-0">#{task.id}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Badge status={task.status} size="xs" />
          <span className="text-xs text-gray-600 ml-auto">{task.timestamp ? timeAgo(task.timestamp) : ""}</span>
        </div>
        <p className={`text-xs text-gray-400 ${expanded ? "" : "truncate"}`}>{task.description}</p>
        {expanded && task.output && (
          <pre className="mt-2 text-[11px] font-mono bg-black/30 p-2.5 rounded-lg overflow-auto max-h-48 whitespace-pre-wrap border border-white/5 text-gray-400">{task.output}</pre>
        )}
      </div>
    </button>
  );
}

function CreateTaskModal({ agents, selectedAgent, taskDesc, setTaskDesc, creating, onClose, onCreate }: {
  agents: { id: string; emoji: string; name: string }[];
  selectedAgent: string;
  taskDesc: string;
  setTaskDesc: (v: string) => void;
  creating: boolean;
  onClose: () => void;
  onCreate: () => void;
}) {
  const a = agents.find(a => a.id === selectedAgent);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="glass-elevated relative w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">Assign Task</h3>
        <div className="text-sm text-gray-400">Agent: <span className="text-white font-medium">{a?.emoji} {a?.name}</span></div>
        <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} placeholder="Describe the task..." className="w-full h-28 px-3 py-2 bg-white/5 border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-emerald-500/40 resize-none" autoFocus />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
          <button onClick={onCreate} disabled={creating || !taskDesc.trim()} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors">
            {creating ? "Creating..." : "Create Task"}
          </button>
        </div>
      </div>
    </div>
  );
}
