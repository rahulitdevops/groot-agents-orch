"use client";
import { useState, useEffect } from "react";
import { useAppState, useAppActions } from "../stores";
import { Card } from "../components/ui/Card";
import { api } from "../utils/api";
import type { SkillsSummary, TeamUsageSummary } from "../types";
import { Badge, ModelBadge } from "../components/ui/Badge";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Skeleton } from "../components/ui/Skeleton";
import { StatusDot } from "../components/ui/StatusDot";
import { timeAgo, formatTokens, formatCost, usageColor, usageTextColor, isToday, formatIST, formatUptimeHuman } from "../utils/formatters";

export function DashboardPage() {
  const { agents, tasks, system, usage, health, gateway, agentsLoading } = useAppState();
  const { setPage } = useAppActions();
  const [expandedActivity, setExpandedActivity] = useState<string | null>(null);
  const [teamSkills, setTeamSkills] = useState<SkillsSummary | null>(null);
  const [teamUsage, setTeamUsage] = useState<TeamUsageSummary | null>(null);
  const [healthScore, setHealthScore] = useState<{ score: number; breakdown?: Record<string, number> } | null>(null);
  const [pendingCheckpoints, setPendingCheckpoints] = useState(0);
  const [observabilityText, setObservabilityText] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashData = () => {
      api<SkillsSummary>("/skills/summary").then(setTeamSkills).catch(() => {});
      api<TeamUsageSummary>("/usage/summary").then(setTeamUsage).catch(() => {});
      api<{ score: number; breakdown?: Record<string, number> }>("/sre/health-score").then(setHealthScore).catch(() => {});
      api<any[]>("/checkpoints?status=pending").then(data => setPendingCheckpoints(Array.isArray(data) ? data.length : 0)).catch(() => {});
      api<{ text: string }>("/observability/text").then(d => setObservabilityText(d?.text || null)).catch(() => {});
    };
    fetchDashData();
    const id = setInterval(fetchDashData, 30000);
    return () => clearInterval(id);
  }, []);

  if (agentsLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-48" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  const activeTasks = tasks.filter(t => t.status === "in_progress" || t.status === "todo");
  const completedToday = tasks.filter(t => t.status === "done" && t.completedAt && isToday(t.completedAt));
  const runningAgents = agents.filter(a => a.status === "running" || a.status === "working");

  const healthColor = healthScore
    ? healthScore.score >= 80 ? "text-emerald-400"
    : healthScore.score >= 60 ? "text-yellow-400"
    : "text-red-400"
    : "text-gray-500";

  return (
    <div className="space-y-5">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
        <StatCard icon="🤖" value={runningAgents.length} total={agents.length} label="Agents" accent />
        <StatCard icon="⚡" value={activeTasks.length} label="Tasks" />
        <StatCard icon="✅" value={completedToday.length} label="Done" />
        <StatCard icon="⏱️" value={formatUptimeHuman(system?.uptime || "—")} label="Uptime" />
        <StatCard
          icon="❤️"
          value={healthScore ? `${healthScore.score}` : "—"}
          label="Health"
          accent={healthScore ? healthScore.score >= 80 : false}
          warn={healthScore ? healthScore.score < 60 : false}
        />
      </div>

      {/* Pending Checkpoints banner */}
      {pendingCheckpoints > 0 && (
        <button
          onClick={() => setPage("workflows")}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/15 transition-colors text-left"
        >
          <span className="text-lg">⏳</span>
          <div className="flex-1">
            <span className="text-sm font-medium">{pendingCheckpoints} checkpoint{pendingCheckpoints > 1 ? "s" : ""} awaiting approval</span>
            <span className="text-xs text-amber-500/70 ml-2">— human-in-loop required</span>
          </div>
          <span className="text-xs text-amber-500/70">View Workflows →</span>
        </button>
      )}

      {/* Agent Status Grid */}
      <Card title="Agent Status" icon="🤖">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {agents.map(a => (
            <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] transition-colors">
              <span className="text-lg shrink-0">{a.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm truncate">{a.name}</span>
                  <StatusDot active={a.status === "running" || a.status === "working"} size="sm" />
                </div>
                {a.model && <ModelBadge model={a.model} />}
                {a.lastTask && <p className="text-xs text-gray-500 mt-1.5 truncate">{a.lastTask}</p>}
                {a.updatedAt && <p className="text-xs text-gray-600 mt-1">{timeAgo(a.updatedAt)}</p>}
              </div>
              <Badge status={a.status} size="xs" />
            </div>
          ))}
          {agents.length === 0 && <p className="text-gray-500 text-sm col-span-full py-4 text-center">No agents loaded</p>}
        </div>
      </Card>

      {/* System Health — compact row */}
      {system && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02] text-sm">
          <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">System</span>
          <SystemMetricPill label="CPU" value={system.cpu.usage} unit="%" />
          <SystemMetricPill label="Mem" value={Math.round((system.memory.used / system.memory.total) * 100)} unit="%" />
          <SystemMetricPill label="Disk" value={system.disk.percent} unit="%" />
          {system.battery.percent >= 0 && (
            <span className="text-xs text-gray-400">{system.battery.charging ? "⚡" : "🔋"} {system.battery.percent}%</span>
          )}
          <span className="text-xs text-gray-500">📶 {system.network.ssid}</span>
          <button
            onClick={() => setPage("sre")}
            className="ml-auto text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            View SRE →
          </button>
        </div>
      )}

      {/* Team Utilization */}
      {teamUsage && teamUsage.taskCount > 0 && (
        <Card title="Team Utilization" icon="💰">
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="text-center">
                <div className="text-xl font-bold text-emerald-400">{formatCost(teamUsage.todayCost)}</div>
                <div className="text-[10px] text-gray-500">Cost Today</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-blue-400">{formatCost(teamUsage.weekCost)}</div>
                <div className="text-[10px] text-gray-500">This Week</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold">{formatTokens(teamUsage.todayTokens)}</div>
                <div className="text-[10px] text-gray-500">Tokens Today</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-purple-400">{teamUsage.taskCount}</div>
                <div className="text-[10px] text-gray-500">Total Tasks</div>
              </div>
            </div>

            {teamUsage.byAgent.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Cost by Agent</p>
                {teamUsage.byAgent.map(a => {
                  const pct = teamUsage.totalCost > 0 ? (a.cost / teamUsage.totalCost) * 100 : 0;
                  return (
                    <div key={a.agent_id} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span>{a.emoji} {a.name || a.agent_id}</span>
                        <span className="text-gray-300">{formatCost(a.cost)} · {a.tasks} tasks</span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-emerald-500 h-1.5 rounded-full transition-all" style={{ width: pct + '%' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {teamUsage.mostActiveToday && (
              <p className="text-xs text-gray-500">
                Most active today: {teamUsage.mostActiveToday.emoji} {teamUsage.mostActiveToday.name} ({teamUsage.mostActiveToday.tasks} tasks, {formatCost(teamUsage.mostActiveToday.cost)})
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Top Skills Leaderboard — compact 3-row table */}
      {teamSkills && teamSkills.totalUnique > 0 && (
        <Card title="Top Skills" icon="🎯">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl font-bold text-purple-400">{teamSkills.totalUnique}</span>
            <span className="text-xs text-gray-500">unique skills across team</span>
          </div>
          <div className="space-y-2">
            {teamSkills.topSkills.slice(0, 3).map((s: any, i: number) => (
              <div key={s.skill} className="flex items-center gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
                <span className="text-xs text-gray-600 w-4">{i + 1}</span>
                <span className="flex-1 text-sm">{s.skill}</span>
                <span className="text-xs text-gray-500">{s.agent_count} agents</span>
                <span className="text-xs text-purple-400">{s.total_uses} uses</span>
              </div>
            ))}
          </div>
          {teamSkills.recentLevelUps.length > 0 && (
            <p className="text-[11px] text-gray-500 mt-2">
              ⬆️ Latest: {teamSkills.recentLevelUps[0].agent_id} — {teamSkills.recentLevelUps[0].skill} ({teamSkills.recentLevelUps[0].old_level} → {teamSkills.recentLevelUps[0].new_level})
            </p>
          )}
        </Card>
      )}

      {/* Observability Digest */}
      {observabilityText && (
        <Card title="Observability Digest" icon="🔭">
          <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">{observabilityText}</p>
        </Card>
      )}

      {/* Live Activity Feed */}
      <Card title="Live Activity" icon="📡">
        <div className="space-y-1">
          {tasks.slice(0, 10).map((t) => {
            const isExpanded = expandedActivity === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setExpandedActivity(isExpanded ? null : t.id)}
                className="w-full text-left flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/[0.03] transition-colors"
              >
                <span className="text-sm shrink-0 mt-0.5">{t.agent.split(" ")[0]}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-gray-300">{t.agent.split(" ").slice(1).join(" ")}</span>
                    <Badge status={t.status} size="xs" />
                    <span className="text-xs text-gray-600 ml-auto shrink-0">{t.timestamp ? timeAgo(t.timestamp) : ""}</span>
                  </div>
                  <p className={`text-xs text-gray-400 ${isExpanded ? "" : "truncate"}`}>{t.description}</p>
                  {isExpanded && t.output && (
                    <pre className="mt-2 text-[11px] font-mono bg-black/30 p-2.5 rounded-lg overflow-auto max-h-48 whitespace-pre-wrap border border-white/5 text-gray-400">
                      {t.output}
                    </pre>
                  )}
                  {isExpanded && t.timestamp && (
                    <p className="text-xs text-gray-600 mt-1">
                      {formatIST(t.timestamp)}
                      {t.completedAt && <span> → {formatIST(t.completedAt)}</span>}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
          {tasks.length === 0 && <p className="text-gray-500 text-sm py-4 text-center">No activity yet</p>}
        </div>
      </Card>
    </div>
  );
}

/* ─── Sub-components ─── */

function StatCard({ icon, value, total, label, accent, warn }: { icon: string; value: string | number; total?: number; label: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-xl text-center py-3 px-1 border border-white/[0.08] bg-white/[0.03] overflow-hidden min-w-0" style={{backdropFilter:"blur(16px)"}}>
      <div className="text-sm">{icon}</div>
      <div className={`text-lg sm:text-2xl font-bold truncate ${warn ? "text-red-400" : accent ? "text-emerald-400" : "text-white"}`}>
        {value}
        {total !== undefined && <span className="text-xs font-normal text-gray-500">/{total}</span>}
      </div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  );
}

function SystemMetricPill({ label, value, unit }: { label: string; value: number; unit: string }) {
  const color = value >= 85 ? "text-red-400" : value >= 70 ? "text-yellow-400" : "text-emerald-400";
  return (
    <span className="text-xs">
      <span className="text-gray-500">{label}: </span>
      <span className={`font-mono font-medium ${color}`}>{value}{unit}</span>
    </span>
  );
}

function UsagePanel({ usage }: { usage: NonNullable<ReturnType<typeof useAppState>["usage"]> }) {
  const limit = usage.monthlyLimit || 100;
  const pct = Math.round((usage.totalCost / limit) * 100);

  return (
    <Card title="AI Usage" icon="📈">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className={`text-2xl font-bold ${usageTextColor(pct)}`}>${usage.totalCost.toFixed(2)}</span>
          <span className="text-xs text-gray-500">/ ${limit} plan</span>
        </div>
        <ProgressBar value={Math.min(pct, 100)} label="Monthly spend" color={usageColor(pct)} />

        {usage.totalTokens > 0 && (
          <p className="text-xs text-gray-500">{formatTokens(usage.totalTokens)} tokens used</p>
        )}

        {usage.models.length > 0 && (
          <div className="space-y-2 pt-3 border-t border-white/5">
            <p className="text-xs text-gray-500">Per-model breakdown</p>
            {usage.models.map(m => {
              const modelPct = usage.totalCost > 0 ? (m.cost / usage.totalCost) * 100 : 0;
              return (
                <div key={m.name} className="space-y-1">
                  <div className="flex justify-between text-xs gap-2">
                    <span className="text-gray-400 font-mono truncate">{m.name}</span>
                    <span className="text-gray-300">${m.cost.toFixed(2)} · {formatTokens(m.tokensIn)}↓ {formatTokens(m.tokensOut)}↑</span>
                  </div>
                  <div className="flex gap-2 items-center">
                    <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-700" style={{ width: `${modelPct}%` }}>
                        <div className="shimmer h-full rounded-full" />
                      </div>
                    </div>
                    {m.cacheHitRatio > 0 && <span className="text-[10px] text-gray-500 shrink-0">cache {Math.round(m.cacheHitRatio * 100)}%</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {usage.fallback && <p className="text-xs text-yellow-400/70">⚠ Fallback data — OpenClaw usage unavailable</p>}
      </div>
    </Card>
  );
}
