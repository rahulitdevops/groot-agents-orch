"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useAppState, useAppActions } from "../stores";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { timeAgo, formatIST } from "../utils/formatters";
import type { Task } from "../types";
import { api } from "../utils/api";

type SortCol = "id" | "agent" | "description" | "status" | "timestamp" | "completedAt";
type SortDir = "asc" | "desc";

const STATUSES = [
  { value: "all", label: "All" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "scheduled", label: "Scheduled" },
  { value: "failed", label: "Failed" },
] as const;

const PAGE_SIZE = 20;

// Request notification permission on first load
function requestNotificationPermission() {
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function showTaskNotification(task: any) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  const emoji = task.agent_emoji || "✅";
  new Notification(`${emoji} Task #${task.id} completed`, {
    body: task.description?.substring(0, 100),
    icon: "/favicon.ico",
    tag: `task-${task.id}`,
  });
}

export function TasksPage() {
  const { agents, tasks, tasksLoading } = useAppState();
  const { fetchAll } = useAppActions();
  const [filterAgent, setFilterAgent] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortCol, setSortCol] = useState<SortCol>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Request notification permission
  useEffect(() => { requestNotificationPermission(); }, []);

  // Track completed tasks for notifications
  const prevTasksRef = useMemo(() => ({ current: new Set<string>() }), []);
  useEffect(() => {
    for (const t of tasks) {
      if ((t.status === "done") && !prevTasksRef.current.has(t.id)) {
        showTaskNotification(t);
      }
    }
    prevTasksRef.current = new Set(tasks.map(t => t.id));
  }, [tasks]);

  // Listen for FAB click from PageShell
  useEffect(() => {
    const handler = () => setShowCreate(true);
    window.addEventListener("groot:create-task", handler);
    return () => window.removeEventListener("groot:create-task", handler);
  }, []);

  // Notify FAB when modal opens/closes
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(showCreate ? "groot:modal-open" : "groot:modal-close"));
  }, [showCreate]);
  const [createAgent, setCreateAgent] = useState("auto");
  const [createDesc, setCreateDesc] = useState("");
  const [createStatus, setCreateStatus] = useState("todo");
  const [runNow, setRunNow] = useState(true);
  const [creating, setCreating] = useState(false);
  const [autoAssignedAgent, setAutoAssignedAgent] = useState<string | null>(null);

  // Auto-assign preview when description changes and agent is "auto"
  const previewAutoAssign = useCallback(async (desc: string) => {
    if (!desc.trim()) { setAutoAssignedAgent(null); return; }
    try {
      const res = await api("/tasks/auto-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc }),
      });
      setAutoAssignedAgent((res as any).agentId);
    } catch { setAutoAssignedAgent(null); }
  }, []);

  useEffect(() => {
    if (createAgent !== "auto") { setAutoAssignedAgent(null); return; }
    const timer = setTimeout(() => previewAutoAssign(createDesc), 300);
    return () => clearTimeout(timer);
  }, [createDesc, createAgent, previewAutoAssign]);

  const filtered = useMemo(() => {
    let list = [...tasks];
    if (filterAgent !== "all") list = list.filter(t => t.agentId === filterAgent);
    if (filterStatus !== "all") list = list.filter(t => t.status === filterStatus);
    list.sort((a, b) => {
      const av = a[sortCol] ?? "";
      const bv = b[sortCol] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [tasks, filterAgent, filterStatus, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  const sortIcon = (col: SortCol) => sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const handleCreate = async () => {
    if (createAgent !== "auto" && !createAgent) return;
    if (!createDesc.trim()) return;
    setCreating(true);
    try {
      await api("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: createAgent,
          description: createDesc.trim(),
          status: createStatus,
          runNow,
        }),
      });
      setCreateDesc("");
      setCreateAgent("auto");
      setCreateStatus("todo");
      setRunNow(true);
      setAutoAssignedAgent(null);
      setShowCreate(false);
      await fetchAll();
    } catch {}
    setCreating(false);
  };

  if (tasksLoading) {
    return <div className="space-y-4"><Skeleton className="h-12" /><Skeleton className="h-96" /></div>;
  }

  const autoAgent = autoAssignedAgent ? agents.find(a => a.id === autoAssignedAgent) : null;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterAgent}
          onChange={e => { setFilterAgent(e.target.value); setPage(0); }}
          className="px-3 py-1.5 bg-white/5 border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-emerald-500/40"
        >
          <option value="all">All Agents</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
        </select>
        <div className="flex gap-1 flex-wrap">
          {STATUSES.map(s => (
            <button
              key={s.value}
              onClick={() => { setFilterStatus(s.value); setPage(0); }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${filterStatus === s.value ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-gray-400 hover:text-white"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="ml-auto text-xs text-gray-500">{filtered.length} tasks</div>
      </div>

      {/* Mobile Card View */}
      <div className="sm:hidden space-y-2">
        {paged.map(t => (
          <TaskMobileCard key={t.id} task={t} expanded={expandedTask === t.id} onToggle={() => setExpandedTask(expandedTask === t.id ? null : t.id)} />
        ))}
        {paged.length === 0 && <p className="text-gray-500 text-sm py-8 text-center">No tasks found</p>}
      </div>

      {/* Desktop Table View */}
      <Card noPadding className="hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-xs text-gray-500 uppercase">
                <th className="text-left px-4 py-3 cursor-pointer hover:text-white transition-colors" onClick={() => toggleSort("id")}>#{ sortIcon("id")}</th>
                <th className="text-left px-4 py-3 cursor-pointer hover:text-white transition-colors" onClick={() => toggleSort("agent")}>Agent{sortIcon("agent")}</th>
                <th className="text-left px-4 py-3 cursor-pointer hover:text-white transition-colors hidden md:table-cell" onClick={() => toggleSort("description")}>Description{sortIcon("description")}</th>
                <th className="text-left px-4 py-3 cursor-pointer hover:text-white transition-colors" onClick={() => toggleSort("status")}>Status{sortIcon("status")}</th>
                <th className="text-left px-4 py-3 cursor-pointer hover:text-white transition-colors" onClick={() => toggleSort("timestamp")}>Created{sortIcon("timestamp")}</th>
                <th className="text-left px-4 py-3 cursor-pointer hover:text-white transition-colors hidden lg:table-cell" onClick={() => toggleSort("completedAt")}>Completed{sortIcon("completedAt")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.map(t => (
                <TaskTableRow key={t.id} task={t} expanded={expandedTask === t.id} onToggle={() => setExpandedTask(expandedTask === t.id ? null : t.id)} />
              ))}
              {paged.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-500 text-sm">No tasks found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 text-xs bg-white/5 rounded-lg disabled:opacity-30 hover:bg-white/10 transition-colors">← Prev</button>
          <span className="text-xs text-gray-500">Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1.5 text-xs bg-white/5 rounded-lg disabled:opacity-30 hover:bg-white/10 transition-colors">Next →</button>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="glass-elevated relative w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Create Task</h3>
            <div>
              <select
                value={createAgent}
                onChange={e => setCreateAgent(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-emerald-500/40"
              >
                <option value="auto">🤖 Auto-assign</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
              </select>
              {createAgent === "auto" && autoAgent && (
                <p className="text-xs text-emerald-400/70 mt-1 ml-1">
                  → Will assign to {autoAgent.emoji} {autoAgent.name}
                </p>
              )}
            </div>
            <textarea value={createDesc} onChange={e => setCreateDesc(e.target.value)} placeholder="Task description..." className="w-full h-28 px-3 py-2 bg-white/5 border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-emerald-500/40 resize-none" autoFocus />
            <select
              value={createStatus}
              onChange={e => setCreateStatus(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-emerald-500/40"
            >
              <option value="todo">Todo</option>
              <option value="in_progress">In Progress</option>
              <option value="scheduled">Scheduled</option>
            </select>
            {/* Run Now toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={runNow}
                  onChange={e => setRunNow(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-10 h-5 rounded-full transition-colors ${runNow ? "bg-emerald-500" : "bg-white/10"}`} />
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${runNow ? "translate-x-5" : ""}`} />
              </div>
              <span className="text-sm text-gray-300">Run immediately</span>
              {runNow && <span className="text-xs text-emerald-400/60">⚡ Agent will start working right away</span>}
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={creating || (createAgent !== "auto" && !createAgent) || !createDesc.trim()} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                {creating ? "Creating..." : runNow ? "Create & Run" : "Create Task"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function TaskMobileCard({ task, expanded, onToggle }: { task: Task; expanded: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="w-full text-left glass-card min-h-[44px] active:scale-[0.98] transition-transform">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium truncate flex-1">{task.agent}</span>
        <Badge status={task.status} size="xs" />
      </div>
      <p className={`text-xs text-gray-400 ${expanded ? "" : "truncate"}`}>{task.description}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-600 font-mono">#{task.id}</span>
        <span className="text-xs text-gray-500">{task.timestamp ? timeAgo(task.timestamp) : "—"}</span>
      </div>
      {expanded && task.output && (
        <pre className="mt-2 text-[11px] font-mono bg-black/30 p-2.5 rounded-lg overflow-auto max-h-48 whitespace-pre-wrap border border-white/5 text-gray-400">{task.output}</pre>
      )}
    </button>
  );
}

function TaskTableRow({ task, expanded, onToggle }: { task: Task; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className="border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors">
        <td className="px-4 py-3 font-mono text-xs text-gray-500">#{task.id}</td>
        <td className="px-4 py-3 text-sm">{task.agent}</td>
        <td className="px-4 py-3 text-xs text-gray-400 max-w-[300px] truncate hidden md:table-cell">{task.description}</td>
        <td className="px-4 py-3"><Badge status={task.status} size="xs" /></td>
        <td className="px-4 py-3 text-xs text-gray-500 hidden sm:table-cell">{task.timestamp ? timeAgo(task.timestamp) : "—"}</td>
        <td className="px-4 py-3 text-xs text-gray-500 hidden lg:table-cell">{task.completedAt ? timeAgo(task.completedAt) : "—"}</td>
      </tr>
      {expanded && (
        <tr className="bg-white/[0.02]">
          <td colSpan={6} className="px-4 py-4">
            <div className="space-y-2">
              <p className="text-sm text-gray-300">{task.description}</p>
              {task.output && (
                <pre className="text-[11px] font-mono bg-black/30 p-3 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap border border-white/5 text-gray-400">{task.output}</pre>
              )}
              <div className="flex gap-4 text-xs text-gray-600">
                {task.timestamp && <span>Created: {formatIST(task.timestamp)}</span>}
                {task.completedAt && <span>Completed: {formatIST(task.completedAt)}</span>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
