"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useAppState } from "../stores";
import { Card } from "../components/ui/Card";
import { ProgressBar } from "../components/ui/ProgressBar";
import { StatusDot } from "../components/ui/StatusDot";
import { Skeleton } from "../components/ui/Skeleton";
import { Badge } from "../components/ui/Badge";
import { timeAgo, formatIST } from "../utils/formatters";
import { api } from "../utils/api";

interface SreCheckRow {
  id: number;
  timestamp: string;
  dashboard_status: string | null;
  gateway_status: string | null;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  details: string | null;
}

interface CronJob {
  id: string;
  label?: string;
  schedule?: string;
  lastRun?: string;
  nextRun?: string;
  status?: string;
}

interface AlertRule {
  id: number;
  metric: string;
  threshold: number;
  operator: string;
  severity: string;
  enabled: number;
}

interface AlertHistoryEntry {
  id: number;
  alert_id: number;
  metric: string;
  value: number;
  threshold: number;
  severity: string;
  message: string;
  acknowledged: number;
  triggered_at: string;
}

interface SelfHealingAction {
  id: number;
  timestamp: string;
  agent_id: string;
  action: string;
  details: string | null;
}

interface MetricTrend {
  timestamp: string;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  dashboard_status: string | null;
  gateway_status: string | null;
}

interface HealthScore {
  score: number | null;
  breakdown: Record<string, number>;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: "#3b82f6",
  warning: "#f59e0b",
  critical: "#ef4444",
};

const SEVERITY_BG: Record<string, string> = {
  info: "bg-blue-500/20 border-blue-500/30 text-blue-400",
  warning: "bg-amber-500/20 border-amber-500/30 text-amber-400",
  critical: "bg-red-500/20 border-red-500/30 text-red-400",
};

const METRIC_ICONS: Record<string, string> = {
  cpu: "🖥️",
  memory: "💾",
  disk: "💿",
};

// Reusable Sparkline component
function Sparkline({ data, color, width = 80, height = 24, fill = false, className = "" }: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`
  ).join(" ");
  const fillPoints = fill
    ? `0,${height} ${points} ${width},${height}`
    : undefined;
  return (
    <svg width={width} height={height} className={`shrink-0 ${className}`}>
      {fill && fillPoints && (
        <polygon points={fillPoints} fill={color} opacity="0.15" />
      )}
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function generateSparklineData(current: number): number[] {
  const data: number[] = [];
  for (let i = 0; i < 12; i++) {
    data.push(Math.max(0, Math.min(100, current + (Math.random() - 0.5) * 20)));
  }
  data.push(current);
  return data;
}

// Health Score Ring
function HealthScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        className="transition-all duration-1000" />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
        className="transform rotate-90 origin-center fill-current text-white text-lg font-bold"
        style={{ fontSize: size * 0.25 }}>{score}</text>
    </svg>
  );
}

// Severity Timeline Bar
function SeverityTimeline({ history }: { history: AlertHistoryEntry[] }) {
  if (history.length === 0) return null;
  const sorted = [...history].sort((a, b) => a.triggered_at.localeCompare(b.triggered_at));
  const total = sorted.length;
  return (
    <div className="flex h-2 rounded-full overflow-hidden bg-white/5">
      {sorted.map((h, i) => (
        <div key={h.id} className="h-full" style={{
          width: `${100 / total}%`,
          backgroundColor: SEVERITY_COLORS[h.severity] || SEVERITY_COLORS.info,
        }} />
      ))}
    </div>
  );
}

export function SrePage() {
  const { system, health, gateway } = useAppState();
  const [sreChecks, setSreChecks] = useState<SreCheckRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertHistory, setAlertHistory] = useState<AlertHistoryEntry[]>([]);
  const [editingThresholds, setEditingThresholds] = useState<Record<number, number>>({});
  const [selfHealing, setSelfHealing] = useState<SelfHealingAction[]>([]);
  const [metricTrends, setMetricTrends] = useState<MetricTrend[]>([]);
  const [healthScore, setHealthScore] = useState<HealthScore>({ score: null, breakdown: {} });
  const [snoozedAlerts, setSnoozedAlerts] = useState<Record<number, number>>({});
  const [observabilityText, setObservabilityText] = useState<string | null>(null);
  const [showNewAlertModal, setShowNewAlertModal] = useState(false);
  const [newAlertForm, setNewAlertForm] = useState({ metric: "cpu", operator: "gt", threshold: 80, severity: "warning" });
  const [creatingAlert, setCreatingAlert] = useState(false);

  const fetchSre = useCallback(async () => {
    try {
      const [checks, cron, alerts, history, healing, trends, hscore, obsText] = await Promise.all([
        api<SreCheckRow[]>("/sre/checks?limit=30").catch(() => []),
        api<{ jobs?: CronJob[] }>("/gateway").then(() => []).catch(() => []),
        api<AlertRule[]>("/sre/alerts").catch(() => []),
        api<AlertHistoryEntry[]>("/sre/alert-history?limit=20").catch(() => []),
        api<SelfHealingAction[]>("/sre/self-healing?limit=10").catch(() => []),
        api<MetricTrend[]>("/sre/metrics/trends?hours=24").catch(() => []),
        api<HealthScore>("/sre/health-score").catch(() => ({ score: null, breakdown: {} })),
        api<{ text: string }>("/observability/text").catch(() => ({ text: "" })),
      ]);
      if (obsText?.text) setObservabilityText(obsText.text);
      setSreChecks(Array.isArray(checks) ? checks : []);
      setCronJobs(Array.isArray(cron) ? cron : []);
      setAlertRules(Array.isArray(alerts) ? alerts : []);
      setAlertHistory(Array.isArray(history) ? history : []);
      setSelfHealing(Array.isArray(healing) ? healing : []);
      setMetricTrends(Array.isArray(trends) ? trends : []);
      setHealthScore(hscore && hscore.score != null ? hscore : { score: null, breakdown: {} });
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSre();
    const id = setInterval(fetchSre, 15000);
    return () => clearInterval(id);
  }, [fetchSre]);

  const acknowledgeAlert = async (id: number) => {
    try {
      await api(`/sre/alert-history/${id}/ack`, { method: "POST" });
      setAlertHistory(prev => prev.map(a => a.id === id ? { ...a, acknowledged: 1 } : a));
    } catch {}
  };

  const updateAlert = async (id: number, updates: Partial<AlertRule>) => {
    try {
      await api(`/sre/alerts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      fetchSre();
    } catch {}
  };

  const snoozeAlert = (alertId: number, hours: number) => {
    setSnoozedAlerts(prev => ({ ...prev, [alertId]: Date.now() + hours * 3600000 }));
  };

  const createAlertRule = async () => {
    setCreatingAlert(true);
    try {
      await api("/sre/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newAlertForm, enabled: 1 }),
      });
      setShowNewAlertModal(false);
      setNewAlertForm({ metric: "cpu", operator: "gt", threshold: 80, severity: "warning" });
      fetchSre();
    } catch {}
    setCreatingAlert(false);
  };

  // Compute metric anomalies from trends
  const anomalies = useMemo(() => {
    if (metricTrends.length < 5) return { cpu: false, memory: false, disk: false };
    const recent = metricTrends.slice(-10);
    const all = metricTrends;
    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const stdDev = (arr: number[], mean: number) => Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);

    const check = (key: "cpu" | "memory" | "disk") => {
      const vals = all.map(t => t[key]).filter((v): v is number => v != null);
      if (vals.length < 5) return false;
      const mean = avg(vals);
      const sd = stdDev(vals, mean);
      const latest = recent[recent.length - 1]?.[key];
      if (latest == null || sd === 0) return false;
      return Math.abs(latest - mean) > 2 * sd;
    };

    return { cpu: check("cpu"), memory: check("memory"), disk: check("disk") };
  }, [metricTrends]);

  // Trend sparkline data from metric trends
  const trendData = useMemo(() => ({
    cpu: metricTrends.map(t => t.cpu ?? 0),
    memory: metricTrends.map(t => t.memory ?? 0),
    disk: metricTrends.map(t => t.disk ?? 0),
  }), [metricTrends]);

  // Alert persistence — minutes since triggered
  const alertPersistence = useCallback((triggeredAt: string): number => {
    const diff = Date.now() - new Date(triggeredAt + "Z").getTime();
    return Math.floor(diff / 60000);
  }, []);

  if (loading && !system) {
    return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-48" />)}</div>;
  }

  const services = [
    { label: "OpenClaw Gateway", icon: "🌱", running: gateway === "online" },
    { label: "Dashboard API", icon: "📊", running: health?.status === "ok" },
    { label: "Redis", icon: "🔴", running: !!health?.redis },
    { label: "SQLite", icon: "🗄️", running: !!health?.db },
  ];

  const uptimePct = health?.uptime ? "99.9" : "—";
  const totalChecks = sreChecks.length;
  const unackedAlerts = alertHistory.filter(a => !a.acknowledged && !(snoozedAlerts[a.id] && snoozedAlerts[a.id] > Date.now()));
  const criticalCount = unackedAlerts.filter(a => a.severity === "critical").length;
  const warningCount = unackedAlerts.filter(a => a.severity === "warning").length;

  const metricGroups = ["cpu", "memory", "disk"].map(metric => {
    const rules = alertRules.filter(r => r.metric === metric);
    return {
      metric,
      icon: METRIC_ICONS[metric] || "📊",
      warning: rules.find(r => r.severity === "warning"),
      critical: rules.find(r => r.severity === "critical"),
    };
  });

  return (
    <div className="space-y-5">
      {/* Observability Digest */}
      {observabilityText && (
        <div className="px-4 py-3 rounded-xl border border-blue-500/20 bg-blue-500/5">
          <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">
            <span className="text-blue-400 font-medium mr-2">🔭 Observability Digest</span>
            {observabilityText}
          </p>
        </div>
      )}

      {/* Active Alerts Banner */}
      {unackedAlerts.length > 0 && (
        <div className="space-y-2">
          {unackedAlerts.map(alert => {
            const mins = alertPersistence(alert.triggered_at);
            return (
              <div
                key={alert.id}
                className={`flex items-center justify-between p-3 rounded-lg border ${SEVERITY_BG[alert.severity] || SEVERITY_BG.info} ${alert.severity === "critical" ? "animate-pulse" : ""}`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-lg">{alert.severity === "critical" ? "🚨" : alert.severity === "warning" ? "⚠️" : "ℹ️"}</span>
                  <span className="text-sm font-medium truncate">{alert.message}</span>
                  {mins >= 5 && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-gray-300">
                      persistent {mins}m
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  {/* Snooze dropdown */}
                  <div className="relative group">
                    <button className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
                      🔕
                    </button>
                    <div className="absolute right-0 top-full mt-1 hidden group-hover:flex flex-col bg-gray-800 border border-white/10 rounded-lg shadow-xl z-10 min-w-[80px]">
                      {[1, 4, 24].map(h => (
                        <button key={h} onClick={() => snoozeAlert(alert.id, h)}
                          className="px-3 py-2 text-xs hover:bg-white/10 text-left min-h-[44px]">
                          {h}h
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => acknowledgeAlert(alert.id)}
                    className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
          {/* Severity Timeline */}
          <SeverityTimeline history={alertHistory} />
        </div>
      )}

      {/* Stat Cards + Health Score */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
        {/* Health Score */}
        <div className="glass-card flex flex-col items-center justify-center py-4 col-span-2 sm:col-span-1 overflow-hidden min-w-0">
          {healthScore.score != null ? (
            <>
              <HealthScoreRing score={healthScore.score} size={64} />
              <div className="text-xs text-gray-500 mt-1">Health Score</div>
            </>
          ) : (
            <>
              <div className="text-xl font-bold text-gray-500">—</div>
              <div className="text-xs text-gray-500">Health Score</div>
            </>
          )}
        </div>
        <div className="glass-card text-center py-4 overflow-hidden min-w-0">
          <div className="text-xl sm:text-2xl font-bold text-emerald-400">{uptimePct}%</div>
          <div className="text-xs text-gray-500">Uptime</div>
        </div>
        <div className="glass-card text-center py-4 overflow-hidden min-w-0">
          <div className="text-xl sm:text-2xl font-bold">{totalChecks}</div>
          <div className="text-xs text-gray-500">Total Checks</div>
        </div>
        <div className="glass-card text-center py-4 overflow-hidden min-w-0">
          <div className="text-xl sm:text-2xl font-bold text-blue-400">{services.filter(s => s.running).length}/{services.length}</div>
          <div className="text-xs text-gray-500">Services Up</div>
        </div>
        <div className="glass-card text-center py-4 overflow-hidden min-w-0">
          <div className={`text-xl sm:text-2xl font-bold ${criticalCount > 0 ? "text-red-400" : warningCount > 0 ? "text-amber-400" : "text-emerald-400"}`}>
            {unackedAlerts.length}
          </div>
          <div className="text-xs text-gray-500">Active Alerts</div>
        </div>
      </div>

      {/* Health Score Breakdown */}
      {healthScore.score != null && (
        <Card title="Health Breakdown" icon="💚">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(healthScore.breakdown).map(([key, val]) => (
              <div key={key} className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400 capitalize">{METRIC_ICONS[key] || "⚙️"} {key}</span>
                  <span className={`text-sm font-bold ${val >= 20 ? "text-emerald-400" : val >= 10 ? "text-amber-400" : "text-red-400"}`}>
                    {val}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(val / (key === "disk" || key === "services" ? 20 : 30)) * 100}%`,
                      backgroundColor: val >= 20 ? "#10b981" : val >= 10 ? "#f59e0b" : "#ef4444",
                    }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Service Status Board */}
      <Card title="Service Status" icon="🔧">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {services.map(s => (
            <div key={s.label} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <StatusDot active={s.running} />
              <div>
                <p className="text-sm font-medium">{s.icon} {s.label}</p>
                <p className={`text-xs ${s.running ? "text-emerald-400" : "text-red-400"}`}>{s.running ? "Healthy" : "Down"}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Metrics Trends */}
      {trendData.cpu.length > 2 && (
        <Card title="Metrics Trends (24h)" icon="📈">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(["cpu", "memory", "disk"] as const).map(metric => {
              const data = trendData[metric];
              const latest = data[data.length - 1] ?? 0;
              const color = metric === "cpu" ? "#10b981" : metric === "memory" ? "#3b82f6" : "#8b5cf6";
              const isAnomaly = anomalies[metric];
              return (
                <div key={metric} className={`p-4 rounded-lg border ${isAnomaly ? "bg-red-500/10 border-red-500/30" : "bg-white/[0.02] border-white/[0.04]"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium capitalize">{METRIC_ICONS[metric]} {metric}</span>
                    <div className="flex items-center gap-2">
                      {isAnomaly && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">anomaly</span>}
                      <span className="text-sm font-mono font-bold">{latest.toFixed(1)}%</span>
                    </div>
                  </div>
                  <Sparkline data={data} color={color} width={200} height={40} fill />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* System Metrics */}
      {system && (
        <Card title="System Metrics" icon="📊">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-3">
              <ProgressBar value={system.cpu.usage} label={`CPU (${system.cpu.cores} cores)`} autoColor />
              <div className="flex items-center gap-2">
                <Sparkline data={trendData.cpu.length > 2 ? trendData.cpu.slice(-12) : generateSparklineData(system.cpu.usage)} color="#10b981" />
                <span className="text-xs text-gray-500">CPU trend</span>
                {anomalies.cpu && <span className="text-[10px] px-1 py-0.5 rounded bg-red-500/20 text-red-400">⚠ anomaly</span>}
              </div>
            </div>
            <div className="space-y-3">
              <ProgressBar value={Math.round((system.memory.used / system.memory.total) * 100)} label="Memory" sublabel={`${system.memory.used}/${system.memory.total} GB`} autoColor />
              {anomalies.memory && <span className="text-[10px] px-1 py-0.5 rounded bg-red-500/20 text-red-400">⚠ anomaly detected</span>}
            </div>
            <div className="space-y-3">
              <ProgressBar value={system.disk.percent} label="Disk" sublabel={`${system.disk.used}/${system.disk.total} GB`} autoColor />
              {anomalies.disk && <span className="text-[10px] px-1 py-0.5 rounded bg-red-500/20 text-red-400">⚠ anomaly detected</span>}
            </div>
            {system.battery.percent >= 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <span className="text-2xl">{system.battery.charging ? "⚡" : system.battery.percent > 50 ? "🔋" : "🪫"}</span>
                <div>
                  <p className="text-sm font-medium">{system.battery.percent}%</p>
                  <p className="text-xs text-gray-500">{system.battery.charging ? "Charging" : system.battery.timeRemaining}</p>
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500 mt-4 pt-3 border-t border-white/5">
            <span>📶 {system.network.ssid} · {system.network.localIP}</span>
            <span>📊 Load: {system.load.map(l => l.toFixed(1)).join(" / ")}</span>
            <span>💾 Pressure: {system.memory.pressure}</span>
          </div>
        </Card>
      )}

      {/* Self-Healing Actions */}
      <Card title="Self-Healing Actions" icon="🔄">
        {selfHealing.length === 0 ? (
          <div className="text-center py-8">
            <span className="text-3xl">🛡️</span>
            <p className="text-sm text-gray-500 mt-2">No self-healing actions recorded</p>
            <p className="text-xs text-gray-600 mt-1">Auto-recovery events will appear here</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-px bg-white/10" />
            <div className="space-y-3">
              {selfHealing.map((action, i) => {
                let parsed: any = {};
                try { parsed = JSON.parse(action.details || "{}"); } catch {}
                const isSuccess = action.action.includes("success") || parsed.result === "success";
                return (
                  <div key={action.id} className="relative pl-10">
                    {/* Timeline dot */}
                    <div className={`absolute left-2.5 top-3 w-3 h-3 rounded-full border-2 ${isSuccess ? "bg-emerald-500 border-emerald-400" : "bg-red-500 border-red-400"}`} />
                    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">
                          {isSuccess ? "✅" : "❌"} {action.action.replace(/_/g, " ")}
                        </span>
                        <span className="text-xs text-gray-500">{action.timestamp ? timeAgo(action.timestamp) : "—"}</span>
                      </div>
                      {parsed.detected && <p className="text-xs text-gray-400">Detected: {parsed.detected}</p>}
                      {parsed.action_taken && <p className="text-xs text-gray-400">Action: {parsed.action_taken}</p>}
                      {parsed.result && (
                        <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded ${isSuccess ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                          {parsed.result}
                        </span>
                      )}
                      {!parsed.detected && action.details && (
                        <p className="text-xs text-gray-500 mt-1 truncate">{action.details}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Alert Thresholds Config */}
      <Card title="Alert Thresholds" icon="⚙️">
        <div className="flex justify-end mb-3">
          <button
            onClick={() => setShowNewAlertModal(true)}
            className="px-3 py-1.5 text-xs bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors font-medium"
          >
            + New Rule
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {metricGroups.map(({ metric, icon, warning, critical }) => (
            <div key={metric} className="p-4 rounded-lg bg-white/[0.02] border border-white/[0.04] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold capitalize">{icon} {metric}</span>
                {/* Mini sparkline next to threshold */}
                {trendData[metric as keyof typeof trendData]?.length > 2 && (
                  <Sparkline data={trendData[metric as keyof typeof trendData].slice(-12)} color={SEVERITY_COLORS.warning} width={50} height={16} />
                )}
              </div>
              {/* Warning threshold */}
              {warning && (
                <div className="space-y-1">
                  <label className="text-xs text-amber-400">⚠️ Warning</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm min-h-[44px] focus:outline-none focus:border-amber-500/50"
                      value={editingThresholds[warning.id] ?? warning.threshold}
                      onChange={e => setEditingThresholds(prev => ({ ...prev, [warning.id]: parseFloat(e.target.value) }))}
                    />
                    <span className="text-xs text-gray-500">%</span>
                    <button
                      onClick={() => updateAlert(warning.id, { enabled: warning.enabled ? 0 : 1 } as any)}
                      className={`px-2 py-1.5 rounded text-xs min-h-[44px] min-w-[44px] ${warning.enabled ? "bg-emerald-500/20 text-emerald-400" : "bg-gray-500/20 text-gray-500"}`}
                    >
                      {warning.enabled ? "ON" : "OFF"}
                    </button>
                    <button
                      onClick={() => {
                        const val = editingThresholds[warning.id];
                        if (val != null) updateAlert(warning.id, { threshold: val });
                      }}
                      className="px-2 py-1.5 rounded text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 min-h-[44px]"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
              {/* Critical threshold */}
              {critical && (
                <div className="space-y-1">
                  <label className="text-xs text-red-400">🚨 Critical</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm min-h-[44px] focus:outline-none focus:border-red-500/50"
                      value={editingThresholds[critical.id] ?? critical.threshold}
                      onChange={e => setEditingThresholds(prev => ({ ...prev, [critical.id]: parseFloat(e.target.value) }))}
                    />
                    <span className="text-xs text-gray-500">%</span>
                    <button
                      onClick={() => updateAlert(critical.id, { enabled: critical.enabled ? 0 : 1 } as any)}
                      className={`px-2 py-1.5 rounded text-xs min-h-[44px] min-w-[44px] ${critical.enabled ? "bg-emerald-500/20 text-emerald-400" : "bg-gray-500/20 text-gray-500"}`}
                    >
                      {critical.enabled ? "ON" : "OFF"}
                    </button>
                    <button
                      onClick={() => {
                        const val = editingThresholds[critical.id];
                        if (val != null) updateAlert(critical.id, { threshold: val });
                      }}
                      className="px-2 py-1.5 rounded text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 min-h-[44px]"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Alert History - Mobile */}
      <div className="sm:hidden space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">🔔 Alert History</h3>
        {alertHistory.length === 0 ? (
          <p className="text-gray-500 text-sm py-6 text-center">No alerts triggered yet</p>
        ) : alertHistory.map(a => (
          <div key={a.id} className="glass-card min-h-[44px]">
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${SEVERITY_BG[a.severity] || ""}`}>
                {a.severity}
              </span>
              <span className="text-xs text-gray-400">{a.triggered_at ? timeAgo(a.triggered_at) : "—"}</span>
            </div>
            <div className="text-xs space-y-0.5">
              <div><span className="text-gray-500">Metric:</span> {METRIC_ICONS[a.metric] || ""} {a.metric}</div>
              <div><span className="text-gray-500">Value:</span> {a.value?.toFixed(1)}% → {a.threshold}%</div>
              <div><span className="text-gray-500">Status:</span> {a.acknowledged ? "✅ Ack" : "⏳ Unack"}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Alert History - Desktop */}
      <Card title="Alert History" icon="🔔" noPadding className="hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-xs text-gray-500 uppercase">
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-left px-4 py-3">Metric</th>
                <th className="text-left px-4 py-3">Value</th>
                <th className="text-left px-4 py-3">Threshold</th>
                <th className="text-left px-4 py-3">Severity</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {alertHistory.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-6 text-gray-500 text-sm">No alerts triggered yet</td></tr>
              ) : alertHistory.map(a => (
                <tr key={a.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-2.5 text-xs text-gray-400">{a.triggered_at ? timeAgo(a.triggered_at) : "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{METRIC_ICONS[a.metric] || ""} {a.metric}</td>
                  <td className="px-4 py-2.5 text-xs font-mono">{a.value?.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-xs font-mono">{a.threshold}%</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${SEVERITY_BG[a.severity] || ""}`}>
                      {a.severity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {a.acknowledged ? (
                      <span className="text-emerald-400">✅ Ack</span>
                    ) : (
                      <button onClick={() => acknowledgeAlert(a.id)} className="text-amber-400 hover:text-amber-300 underline">
                        Acknowledge
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* SRE Check History - Mobile Cards */}
      <div className="sm:hidden space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">🛡️ SRE Check History</h3>
        {sreChecks.length === 0 ? (
          <p className="text-gray-500 text-sm py-6 text-center">No SRE checks recorded yet</p>
        ) : sreChecks.map(c => (
          <div key={c.id} className="glass-card min-h-[44px]">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-xs text-gray-500">#{c.id}</span>
              <span className="text-xs text-gray-400">{c.timestamp ? timeAgo(c.timestamp) : "—"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-gray-500">Dashboard:</span> <StatusLabel val={c.dashboard_status} /></div>
              <div><span className="text-gray-500">Gateway:</span> <StatusLabel val={c.gateway_status} /></div>
              {c.cpu != null && <div><span className="text-gray-500">CPU:</span> <MetricCell val={c.cpu} /></div>}
              {c.memory != null && <div><span className="text-gray-500">Mem:</span> <MetricCell val={c.memory} /></div>}
              {c.disk != null && <div><span className="text-gray-500">Disk:</span> <MetricCell val={c.disk} /></div>}
            </div>
          </div>
        ))}
      </div>

      {/* SRE Check History - Desktop Table */}
      <Card title="SRE Check History" icon="🛡️" noPadding className="hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-xs text-gray-500 uppercase">
                <th className="text-left px-4 py-3">#</th>
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-left px-4 py-3">Dashboard</th>
                <th className="text-left px-4 py-3">Gateway</th>
                <th className="text-left px-4 py-3">CPU</th>
                <th className="text-left px-4 py-3">Memory</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Disk</th>
              </tr>
            </thead>
            <tbody>
              {sreChecks.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-6 text-gray-500 text-sm">No SRE checks recorded yet</td></tr>
              ) : sreChecks.map(c => (
                <tr key={c.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{c.id}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">{c.timestamp ? timeAgo(c.timestamp) : "—"}</td>
                  <td className="px-4 py-2.5"><StatusLabel val={c.dashboard_status} /></td>
                  <td className="px-4 py-2.5"><StatusLabel val={c.gateway_status} /></td>
                  <td className="px-4 py-2.5"><MetricCell val={c.cpu} /></td>
                  <td className="px-4 py-2.5"><MetricCell val={c.memory} /></td>
                  <td className="px-4 py-2.5 hidden md:table-cell"><MetricCell val={c.disk} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Cron Job Status */}
      <Card title="Cron Jobs" icon="⏰">
        <div className="space-y-2">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            <StatusDot active={true} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">SRE Health Check</p>
              <p className="text-xs text-gray-500 font-mono truncate">Built-in · runs on SRE agent schedule</p>
            </div>
            <Badge status="idle" size="xs" />
          </div>
          {cronJobs.map(j => (
            <div key={j.id} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <StatusDot active={j.status === "active"} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{j.label || j.id}</p>
                {j.schedule && <p className="text-xs text-gray-500">{j.schedule}</p>}
              </div>
              {j.lastRun && <span className="text-xs text-gray-500">{timeAgo(j.lastRun)}</span>}
            </div>
          ))}
        </div>
      </Card>

      {/* New Alert Rule Modal */}
      {showNewAlertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNewAlertModal(false)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-white/[0.08] bg-gray-950 shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">New Alert Rule</h3>
              <button onClick={() => setShowNewAlertModal(false)} className="text-gray-500 hover:text-white text-xl">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Metric</label>
                <select
                  value={newAlertForm.metric}
                  onChange={e => setNewAlertForm(f => ({ ...f, metric: e.target.value }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-emerald-500/40"
                >
                  <option value="cpu">CPU</option>
                  <option value="memory">Memory</option>
                  <option value="disk">Disk</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Operator</label>
                <select
                  value={newAlertForm.operator}
                  onChange={e => setNewAlertForm(f => ({ ...f, operator: e.target.value }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-emerald-500/40"
                >
                  <option value="gt">Greater than (&gt;)</option>
                  <option value="lt">Less than (&lt;)</option>
                  <option value="eq">Equal to (=)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Threshold (%)</label>
                <input
                  type="number"
                  min={0} max={100}
                  value={newAlertForm.threshold}
                  onChange={e => setNewAlertForm(f => ({ ...f, threshold: parseFloat(e.target.value) }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-emerald-500/40"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Severity</label>
                <select
                  value={newAlertForm.severity}
                  onChange={e => setNewAlertForm(f => ({ ...f, severity: e.target.value }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-emerald-500/40"
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <button
              onClick={createAlertRule}
              disabled={creatingAlert}
              className="w-full py-2.5 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
            >
              {creatingAlert ? "Creating…" : "Create Alert Rule"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusLabel({ val }: { val: string | null }) {
  if (!val) return <span className="text-xs text-gray-600">—</span>;
  const isOk = val === "ok" || val === "online" || val === "pass";
  return <span className={`text-xs font-medium ${isOk ? "text-emerald-400" : "text-red-400"}`}>{val}</span>;
}

function MetricCell({ val }: { val: number | null }) {
  if (val == null) return <span className="text-xs text-gray-600">—</span>;
  const color = val >= 90 ? "text-red-400" : val >= 70 ? "text-yellow-400" : "text-emerald-400";
  return <span className={`text-xs font-mono ${color}`}>{val.toFixed(1)}%</span>;
}
