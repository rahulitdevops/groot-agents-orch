"use client";
import { useState, useEffect, useCallback } from "react";
import { Card } from "../components/ui/Card";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Skeleton } from "../components/ui/Skeleton";
import { api } from "../utils/api";
import { formatCost, formatTokens, formatDuration, timeAgo, usageTextColor } from "../utils/formatters";

interface Summary {
  totalTokens: number;
  totalCost: number;
  taskCount: number;
  todayCost: number;
  todayTokens: number;
  weekCost: number;
}

interface DailyEntry { date: string; cost: number; tokens: number }
interface AgentEntry { agent_id: string; name: string; emoji: string; cost: number; tokens: number; tasks: number }
interface ModelEntry { model: string; input_tokens: number; output_tokens: number; cache_tokens: number; total_tokens: number; cost: number }
interface RecentEntry {
  agent_id: string; agent_name: string; agent_emoji: string;
  task_description: string | null;
  total_tokens: number; input_tokens: number; output_tokens: number; cache_tokens: number;
  cost_usd: number; duration_ms: number; model: string; recorded_at: string;
}

interface PlanConfig {
  name: string;
  price: number;
  provider: string;
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: string }) {
  return (
    <div className="glass-card flex items-center gap-3">
      <span className="text-2xl">{icon}</span>
      <div className="min-w-0">
        <div className="text-lg font-bold text-white truncate">{value}</div>
        <div className="text-xs text-gray-400">{label}</div>
        {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function DailyChart({ data }: { data: DailyEntry[] }) {
  if (!data.length) return <div className="text-gray-500 text-sm">No daily data</div>;
  const max = Math.max(...data.map(d => d.cost), 0.01);
  return (
    <div className="flex items-end gap-1.5 h-32">
      {data.map(d => {
        const pct = (d.cost / max) * 100;
        const dayLabel = new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric" });
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <span className="text-[10px] text-gray-400">{formatCost(d.cost)}</span>
            <div className="w-full bg-white/5 rounded-t flex-1 relative" style={{ minHeight: 4 }}>
              <div
                className="absolute bottom-0 left-0 right-0 bg-emerald-500/60 rounded-t transition-all duration-500"
                style={{ height: `${Math.max(pct, 4)}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-500 truncate w-full text-center">{dayLabel}</span>
          </div>
        );
      })}
    </div>
  );
}

function TokenBar({ input, output, cache }: { input: number; output: number; cache: number }) {
  const total = input + output + cache;
  if (!total) return null;
  const pI = (input / total) * 100;
  const pO = (output / total) * 100;
  const pC = (cache / total) * 100;
  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden bg-white/5">
        <div className="bg-blue-500/70 transition-all" style={{ width: `${pI}%` }} />
        <div className="bg-purple-500/70 transition-all" style={{ width: `${pO}%` }} />
        <div className="bg-emerald-500/50 transition-all" style={{ width: `${pC}%` }} />
      </div>
      <div className="flex gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500/70 inline-block" /> Input {formatTokens(input)}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500/70 inline-block" /> Output {formatTokens(output)}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500/50 inline-block" /> Cache {formatTokens(cache)}</span>
      </div>
    </div>
  );
}

export function UsagePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DailyEntry[]>([]);
  const [byAgent, setByAgent] = useState<AgentEntry[]>([]);
  const [byModel, setByModel] = useState<ModelEntry[]>([]);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [plan, setPlan] = useState<PlanConfig>({ name: 'Claude Max', price: 100, provider: 'Anthropic' });
  const [monthlyLimit, setMonthlyLimit] = useState(100);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const [s, d, a, m, r] = await Promise.all([
      api<Summary>("/usage/summary").catch(() => ({ totalTokens: 0, totalCost: 0, taskCount: 0, todayCost: 0, todayTokens: 0, weekCost: 0 })),
      api<DailyEntry[]>("/usage/daily?days=7").catch(() => []),
      api<AgentEntry[]>("/usage/by-agent").catch(() => []),
      api<ModelEntry[]>("/usage/by-model").catch(() => []),
      api<RecentEntry[]>("/usage/recent?limit=20").catch(() => []),
    ]);
    setSummary(s);
    setDaily(Array.isArray(d) ? d : []);
    setByAgent(Array.isArray(a) ? a : []);
    setByModel(Array.isArray(m) ? m : []);
    setRecent(Array.isArray(r) ? r : []);
    setLoading(false);
  }, []);

  // Fetch config (plan info) once
  useEffect(() => {
    api<{ plan: PlanConfig; monthlyLimit: number }>("/config")
      .then(cfg => {
        if (cfg?.plan) setPlan(cfg.plan);
        if (cfg?.monthlyLimit) setMonthlyLimit(cfg.monthlyLimit);
      })
      .catch(() => {});
  }, []);

  // Fetch usage data + auto-refresh every 30s
  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">💰 Usage & Costs</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
        <Skeleton className="h-40" />
        <Skeleton className="h-60" />
      </div>
    );
  }

  const s = summary!;
  const budgetPct = s.totalCost > 0 ? Math.min((s.totalCost / monthlyLimit) * 100, 100) : 0;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysRemaining = daysInMonth - now.getDate();
  const totalAgentCost = byAgent.reduce((sum, a) => sum + a.cost, 0) || 1;
  const totalModelTokens = byModel.reduce((sum, m) => sum + m.total_tokens, 0);
  const totalInput = byModel.reduce((sum, m) => sum + m.input_tokens, 0);
  const totalOutput = byModel.reduce((sum, m) => sum + m.output_tokens, 0);
  const totalCache = byModel.reduce((sum, m) => sum + m.cache_tokens, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-white flex items-center gap-2">💰 Usage & Costs</h1>

      {/* Top Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon="💵" label="Total Cost" value={formatCost(s.totalCost)} sub={`${s.taskCount} tasks`} />
        <StatCard icon="📅" label="Today" value={formatCost(s.todayCost)} />
        <StatCard icon="📊" label="This Week" value={formatCost(s.weekCost)} />
        <StatCard icon="🔤" label="Total Tokens" value={formatTokens(s.totalTokens)} />
      </div>

      {/* Budget Tracker */}
      <Card title="Monthly Budget" icon="🎯">
        <ProgressBar
          value={budgetPct}
          label={`${formatCost(s.totalCost)} / ${formatCost(monthlyLimit)}`}
          sublabel={`${budgetPct.toFixed(1)}% used · ${daysRemaining}d remaining`}
          autoColor
          height="md"
        />
      </Card>

      {/* Subscription Plan */}
      <Card title="Claude Subscription" icon="🧠">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center text-xl">⚡</div>
            <div>
              <div className="text-white font-semibold">{plan.name}</div>
              <div className="text-xs text-gray-400">{plan.provider} · ${plan.price}/mo</div>
            </div>
          </div>
          <div className="flex gap-4 text-sm">
            <div className="text-center">
              <div className="text-white font-medium">{formatCost(s.totalCost)}</div>
              <div className="text-[10px] text-gray-500">All-time cost</div>
            </div>
            <div className="text-center">
              <div className="text-white font-medium">{formatCost(s.weekCost)}</div>
              <div className="text-[10px] text-gray-500">This week</div>
            </div>
            <div className="text-center">
              <div className={`font-medium ${budgetPct > 80 ? "text-red-400" : budgetPct > 50 ? "text-amber-400" : "text-emerald-400"}`}>
                {budgetPct.toFixed(0)}%
              </div>
              <div className="text-[10px] text-gray-500">Budget used</div>
            </div>
          </div>
        </div>
        <div className="mt-3 text-xs text-gray-500 border-t border-white/5 pt-2">
          Rate limits (session/weekly) are managed by Anthropic and cannot be fetched via API.
          Track actual spend above — your agents' token costs are recorded automatically.
        </div>
      </Card>

      {/* Token Distribution */}
      {totalModelTokens > 0 && (
        <Card title="Token Distribution" icon="📦">
          <TokenBar input={totalInput} output={totalOutput} cache={totalCache} />
        </Card>
      )}

      {/* Daily Trend */}
      <Card title="7-Day Cost Trend" icon="📈">
        <DailyChart data={daily} />
      </Card>

      {/* Cost by Agent + Cost by Model side by side on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Cost by Agent" icon="🤖">
          {byAgent.length === 0 ? (
            <div className="text-gray-500 text-sm">No agent data</div>
          ) : (
            <div className="space-y-3">
              {byAgent.map(a => {
                const pct = (a.cost / totalAgentCost) * 100;
                return (
                  <div key={a.agent_id} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300">{a.emoji} {a.name}</span>
                      <span className="text-gray-400">{formatCost(a.cost)} · {a.tasks} tasks</span>
                    </div>
                    <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                      <div className="bg-emerald-500/60 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[10px] text-gray-500 text-right">{pct.toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Cost by Model" icon="🧠">
          {byModel.length === 0 ? (
            <div className="text-gray-500 text-sm">No model data</div>
          ) : (
            <div className="space-y-3">
              {byModel.map(m => {
                const totalModelCost = byModel.reduce((s, x) => s + x.cost, 0) || 1;
                const pct = (m.cost / totalModelCost) * 100;
                const modelName = (m.model || "unknown").split("/").pop() || m.model;
                return (
                  <div key={m.model} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300 font-medium">{modelName}</span>
                      <span className="text-gray-400">{formatCost(m.cost)}</span>
                    </div>
                    <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                      <div className="bg-purple-500/60 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <TokenBar input={m.input_tokens} output={m.output_tokens} cache={m.cache_tokens} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Recent Tasks */}
      <Card title="Recent Usage" icon="🕐" noPadding>
        {recent.length === 0 ? (
          <div className="text-gray-500 text-sm p-4">No recent usage</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-white/5">
                    <th className="text-left px-4 py-2 font-medium">Agent</th>
                    <th className="text-left px-4 py-2 font-medium">Task</th>
                    <th className="text-right px-4 py-2 font-medium">Tokens</th>
                    <th className="text-right px-4 py-2 font-medium">Cost</th>
                    <th className="text-right px-4 py-2 font-medium">Duration</th>
                    <th className="text-left px-4 py-2 font-medium">Model</th>
                    <th className="text-right px-4 py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r, i) => (
                    <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 text-gray-300">{r.agent_emoji} {r.agent_name}</td>
                      <td className="px-4 py-2.5 text-gray-400 max-w-[200px] truncate">{r.task_description || "—"}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-right">{formatTokens(r.total_tokens)}</td>
                      <td className="px-4 py-2.5 text-gray-300 text-right font-medium">{formatCost(r.cost_usd)}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-right">{r.duration_ms ? formatDuration(r.duration_ms) : "—"}</td>
                      <td className="px-4 py-2.5 text-gray-500">{(r.model || "").split("/").pop()}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-right">{timeAgo(r.recorded_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2 p-3">
              {recent.map((r, i) => (
                <div key={i} className="glass-card !p-3 space-y-1.5">
                  <div className="flex justify-between items-start">
                    <span className="text-sm text-gray-300">{r.agent_emoji} {r.agent_name}</span>
                    <span className="text-sm font-medium text-white">{formatCost(r.cost_usd)}</span>
                  </div>
                  {r.task_description && <div className="text-xs text-gray-400 truncate">{r.task_description}</div>}
                  <div className="flex gap-3 text-xs text-gray-500">
                    <span>{formatTokens(r.total_tokens)} tok</span>
                    {r.duration_ms > 0 && <span>{formatDuration(r.duration_ms)}</span>}
                    <span>{(r.model || "").split("/").pop()}</span>
                    <span className="ml-auto">{timeAgo(r.recorded_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
