"use client";
import { useState, useEffect } from "react";
import { useAppState, useAppActions } from "../stores";
import { Card } from "../components/ui/Card";
import { Badge, ModelBadge } from "../components/ui/Badge";
import { StatusDot } from "../components/ui/StatusDot";
import { api } from "../utils/api";

interface AppConfig {
  version: string;
  apiPort: number;
  gatewayPort: number;
  plan: { name: string; price: number; provider: string };
  monthlyLimit: number;
  dailyLimit: number;
  cronJobs: { id: string; name: string; schedule?: string; enabled?: boolean; last_run?: string }[];
  agentStats: { total: number; active: number };
}

export function SettingsPage() {
  const { agents, health, gateway } = useAppState();
  const { logout, fetchAll } = useAppActions();
  const [gatewayInfo, setGatewayInfo] = useState<any>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    api("/gateway").then(setGatewayInfo).catch(() => {});
    api<AppConfig>("/config").then(setConfig).catch(() => {});
  }, []);

  const token = typeof window !== "undefined" ? localStorage.getItem("groot-token") : null;
  const maskedToken = token ? token.slice(0, 4) + "····" + token.slice(-4) : "—";

  return (
    <div className="space-y-5">
      {/* Dashboard Info */}
      <Card title="Dashboard" icon="📊">
        <div className="space-y-3">
          <SettingsRow label="Version" value={config?.version || "—"} />
          <SettingsRow label="API Port" value={config ? String(config.apiPort) : "—"} />
          <SettingsRow label="Auth Token" value={maskedToken} mono />
          <SettingsRow label="API Status" value={health?.status === "ok" ? "✅ Connected" : "❌ Disconnected"} />
          <SettingsRow label="Database" value={health?.db ? "✅ SQLite OK" : "❌ SQLite Down"} />
          <SettingsRow label="Redis" value={health?.redis ? "✅ Connected" : "⚠️ Not connected"} />
        </div>
      </Card>

      {/* OpenClaw Info */}
      <Card title="OpenClaw Gateway" icon="🌱">
        <div className="space-y-3">
          <SettingsRow label="Status" value={gateway === "online" ? "✅ Online" : "❌ Offline"} />
          <SettingsRow label="Port" value={config ? String(config.gatewayPort) : "—"} />
          {gatewayInfo && typeof gatewayInfo === "object" && (
            <>
              {gatewayInfo.version && <SettingsRow label="Version" value={gatewayInfo.version} />}
              {gatewayInfo.uptime && <SettingsRow label="Uptime" value={String(gatewayInfo.uptime)} />}
            </>
          )}
        </div>
      </Card>

      {/* Agent Configuration */}
      <Card title="Agent Configuration" icon="🤖">
        <div className="space-y-2">
          {agents.map(a => (
            <AgentConfigCard key={a.id} agent={a} onUpdate={fetchAll} />
          ))}
          {agents.length === 0 && <p className="text-center py-6 text-gray-500 text-sm">No agents</p>}
        </div>
      </Card>

      {/* Cron Jobs */}
      <Card title="Cron Jobs" icon="⏰">
        <div className="space-y-2">
          {config?.cronJobs && config.cronJobs.length > 0 ? (
            config.cronJobs.map(job => (
              <div key={job.id} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] overflow-hidden">
                <StatusDot active={job.enabled !== false} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{job.name}</p>
                    <Badge status="idle" size="xs" />
                  </div>
                  <p className="text-xs text-gray-500 font-mono truncate">{job.id}</p>
                  {job.last_run && <p className="text-xs text-gray-500">Last: {job.last_run}</p>}
                </div>
              </div>
            ))
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] overflow-hidden">
              <StatusDot active={true} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">SRE Health Check</p>
                  <Badge status="idle" size="xs" />
                </div>
                <p className="text-xs text-gray-500">Built-in · runs on SRE agent schedule</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Actions */}
      <Card title="Actions" icon="⚡">
        <div className="flex flex-wrap gap-3">
          <button onClick={() => fetchAll()} className="px-4 py-2.5 min-h-[44px] bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-500/30 transition-colors">
            🔄 Refresh All Data
          </button>
          <button onClick={logout} className="px-4 py-2.5 min-h-[44px] bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors">
            🚪 Logout
          </button>
        </div>
      </Card>
    </div>
  );
}

function SettingsRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
      <span className="text-sm text-gray-400">{label}</span>
      <span className={`text-sm ${mono ? "font-mono text-gray-300" : "text-white"}`}>{value}</span>
    </div>
  );
}

function AgentConfigCard({ agent, onUpdate }: { agent: any; onUpdate: () => void }) {
  const [editing, setEditing] = useState(false);
  const [model, setModel] = useState(agent.model || "");
  const [status, setStatus] = useState(agent.status || "idle");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api(`/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, status }),
      });
      setEditing(false);
      onUpdate();
    } catch {}
    setSaving(false);
  };

  return (
    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{agent.emoji}</span>
          <span className="font-medium text-sm">{agent.name}</span>
        </div>
        {!editing && <button onClick={() => setEditing(true)} className="px-3 py-1 text-xs text-gray-400 hover:text-white bg-white/5 rounded-lg transition-colors">Edit</button>}
      </div>
      {editing ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-14">Model</span>
            <input value={model} onChange={e => setModel(e.target.value)} className="flex-1 px-2 py-1.5 bg-white/5 border border-white/[0.08] rounded-lg text-xs focus:outline-none focus:border-emerald-500/40" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-14">Status</span>
            <select value={status} onChange={e => setStatus(e.target.value)} className="flex-1 px-2 py-1.5 bg-white/5 border border-white/[0.08] rounded-lg text-xs focus:outline-none focus:border-emerald-500/40">
              <option value="idle">idle</option>
              <option value="in_progress">in_progress</option>
              <option value="done">done</option>
              <option value="failed">failed</option>
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-xs bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors">
              {saving ? "Saving..." : "Save"}
            </button>
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <ModelBadge model={agent.model || "—"} />
          <span className="text-xs text-gray-500">{agent.tier || "—"}</span>
          <Badge status={agent.status} size="xs" />
        </div>
      )}
    </div>
  );
}
