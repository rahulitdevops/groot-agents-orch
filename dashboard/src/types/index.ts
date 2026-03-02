export interface Agent {
  id: string;
  name: string;
  emoji: string;
  model: string;
  tier: string;
  status: "idle" | "running" | "working" | "completed" | "failed";
  lastTask: string | null;
  updatedAt?: string;
}

export interface Task {
  id: string;
  agentId: string;
  agent: string;
  description: string;
  status: "todo" | "in_progress" | "done" | "scheduled" | "failed";
  output?: string;
  timestamp?: string;
  completedAt?: string;
}

export interface SreCheck {
  id: string;
  name: string;
  category: string;
  status: "pass" | "fail" | "warn" | "skip";
  message: string;
  lastRun?: string;
}

export interface SystemInfo {
  hostname: string;
  os: string;
  arch: string;
  cpu: { model: string; cores: number; usage: number };
  memory: { total: number; used: number; free: number; unit: string; pressure: string };
  disk: { total: number; used: number; free: number; unit: string; percent: number };
  battery: { percent: number; charging: boolean; timeRemaining: string };
  uptime: string;
  network: { wifi: string; ssid: string; localIP: string };
  processes: Record<string, { running: boolean; pid?: number; memory?: string }>;
  load: number[];
}

export interface ModelUsage {
  name: string;
  tokensIn: number;
  tokensOut: number;
  cacheHitRatio: number;
  cost: number;
}

export interface Usage {
  totalCost: number;
  totalTokens: number;
  models: ModelUsage[];
  monthlyLimit: number;
  fallback?: boolean;
}

export interface HealthInfo {
  status: string;
  db: boolean;
  redis: boolean;
  uptime: number;
}

export type PageId = "dashboard" | "agents" | "tasks" | "workflows" | "sre" | "usage" | "settings";
export type ConnStatus = "live" | "polling" | "offline";

export interface SearchResult {
  tasks: { id: string; agentId: string; description: string; status: string; timestamp: string; type: string }[];
  files: { name: string; path: string; type: string; source: string }[];
}

export interface AgentSkill {
  id: number;
  agent_id: string;
  skill: string;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  xp: number;
  acquired_at: string;
  last_used: string | null;
  times_used: number;
}

export interface SkillLogEntry {
  id: number;
  agent_id: string;
  skill: string;
  action: 'acquired' | 'leveled_up' | 'used';
  old_level: string | null;
  new_level: string | null;
  xp_gained: number;
  task_id: number | null;
  logged_at: string;
}

export interface SkillsSummary {
  totalUnique: number;
  topSkills: { skill: string; total_uses: number; agent_count: number }[];
  recentLevelUps: SkillLogEntry[];
}

export interface AgentUsageEntry {
  id: number;
  agent_id: string;
  task_id: number | null;
  session_key: string;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  total_tokens: number;
  cost_usd: number;
  model: string;
  duration_ms: number;
  recorded_at: string;
  task_description?: string;
}

export interface AgentUsageSummary {
  totalTokens: number;
  totalCost: number;
  taskCount: number;
  avgTokensPerTask: number;
  avgCostPerTask: number;
  byModel: Record<string, { tokens: number; cost: number }>;
  daily: { date: string; tokens: number; cost: number }[];
}

export interface TeamUsageSummary {
  totalTokens: number;
  totalCost: number;
  taskCount: number;
  todayCost: number;
  todayTokens: number;
  weekCost: number;
  byAgent: { agent_id: string; name: string; emoji: string; tokens: number; cost: number; tasks: number }[];
  byModel: Record<string, { tokens: number; cost: number }>;
  daily: { date: string; tokens: number; cost: number }[];
  mostActiveToday: { agent_id: string; name: string; emoji: string; tasks: number; cost: number } | null;
}
