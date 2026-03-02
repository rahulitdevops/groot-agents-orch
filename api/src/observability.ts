/**
 * Observability — "What happened while I was away?"
 *
 * Generates human-readable summaries of system activity over a time period.
 * Reads from activity_log, tasks, agent_usage, sre_checks, workflows, etc.
 *
 * Longer-Term Improvement #5
 */

import db from './db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivitySummary {
  period: { from: string; to: string; hours: number };
  highlights: string[];
  agents: AgentActivitySummary[];
  tasks: TaskSummary;
  workflows: WorkflowSummary;
  sre: SreSummary;
  cost: CostSummary;
  checkpoints: CheckpointSummary;
}

interface AgentActivitySummary {
  agentId: string;
  name: string;
  emoji: string;
  tasksCompleted: number;
  tasksFailed: number;
  lastActive: string | null;
  actions: string[];
}

interface TaskSummary {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  avgCompletionMinutes: number;
  topDescriptions: string[];
}

interface WorkflowSummary {
  total: number;
  completed: number;
  failed: number;
  running: number;
}

interface SreSummary {
  checksRun: number;
  alertsTriggered: number;
  incidentsResolved: number;
  avgCpu: number;
  avgMemory: number;
  avgDisk: number;
}

interface CostSummary {
  totalCost: number;
  totalTokens: number;
  byAgent: Array<{ agentId: string; cost: number; tokens: number }>;
}

interface CheckpointSummary {
  pending: number;
  approved: number;
  rejected: number;
}

// ---------------------------------------------------------------------------
// Generate summary for a time period
// ---------------------------------------------------------------------------

export function generateSummary(hoursBack: number = 24): ActivitySummary {
  const fromTime = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();
  const toTime = new Date().toISOString();

  const agents = getAgentActivity(fromTime);
  const tasks = getTaskSummary(fromTime);
  const workflows = getWorkflowSummary(fromTime);
  const sre = getSreSummary(fromTime);
  const cost = getCostSummary(fromTime);
  const checkpoints = getCheckpointSummary(fromTime);
  const highlights = buildHighlights(agents, tasks, workflows, sre, cost, checkpoints, hoursBack);

  return {
    period: { from: fromTime, to: toTime, hours: hoursBack },
    highlights,
    agents,
    tasks,
    workflows,
    sre,
    cost,
    checkpoints,
  };
}

// ---------------------------------------------------------------------------
// Generate human-readable text summary (for WhatsApp)
// ---------------------------------------------------------------------------

export function generateTextSummary(hoursBack: number = 24): string {
  const s = generateSummary(hoursBack);
  const lines: string[] = [];

  lines.push(`📊 *Groot Summary — Last ${s.period.hours}h*`);
  lines.push('');

  if (s.highlights.length > 0) {
    lines.push('*Highlights:*');
    for (const h of s.highlights) {
      lines.push(`• ${h}`);
    }
    lines.push('');
  }

  // Tasks
  if (s.tasks.total > 0) {
    lines.push(`*Tasks:* ${s.tasks.completed} completed, ${s.tasks.failed} failed, ${s.tasks.inProgress} in progress`);
    if (s.tasks.avgCompletionMinutes > 0) {
      lines.push(`  Avg completion: ${Math.round(s.tasks.avgCompletionMinutes)}min`);
    }
  } else {
    lines.push('*Tasks:* No tasks ran');
  }

  // Workflows
  if (s.workflows.total > 0) {
    lines.push(`*Workflows:* ${s.workflows.completed} completed, ${s.workflows.running} running, ${s.workflows.failed} failed`);
  }

  // Agent activity
  const activeAgents = s.agents.filter(a => a.tasksCompleted > 0 || a.tasksFailed > 0);
  if (activeAgents.length > 0) {
    lines.push('');
    lines.push('*Agent Activity:*');
    for (const a of activeAgents) {
      const status = a.tasksFailed > 0
        ? `${a.tasksCompleted}✅ ${a.tasksFailed}❌`
        : `${a.tasksCompleted}✅`;
      lines.push(`${a.emoji} ${a.name}: ${status}`);
    }
  }

  // SRE
  if (s.sre.checksRun > 0) {
    lines.push('');
    lines.push(`*Infrastructure:* CPU ${Math.round(s.sre.avgCpu)}%, Mem ${Math.round(s.sre.avgMemory)}%, Disk ${Math.round(s.sre.avgDisk)}%`);
    if (s.sre.alertsTriggered > 0) {
      lines.push(`  ⚠️ ${s.sre.alertsTriggered} alerts triggered`);
    }
  }

  // Checkpoints
  if (s.checkpoints.pending > 0) {
    lines.push('');
    lines.push(`⏸️ *${s.checkpoints.pending} checkpoint(s) awaiting approval*`);
  }

  // Cost
  if (s.cost.totalCost > 0) {
    lines.push('');
    lines.push(`*Cost:* $${s.cost.totalCost.toFixed(4)} (${s.cost.totalTokens.toLocaleString()} tokens)`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal: Get agent activity
// ---------------------------------------------------------------------------

function getAgentActivity(fromTime: string): AgentActivitySummary[] {
  const agents = db.prepare('SELECT * FROM agents').all() as any[];

  return agents.map(agent => {
    const completed = (db.prepare(
      "SELECT COUNT(*) as c FROM tasks WHERE agent_id = ? AND status IN ('completed', 'done') AND completed_at >= ?"
    ).get(agent.id, fromTime) as any)?.c || 0;

    const failed = (db.prepare(
      "SELECT COUNT(*) as c FROM tasks WHERE agent_id = ? AND status = 'failed' AND created_at >= ?"
    ).get(agent.id, fromTime) as any)?.c || 0;

    const recentActions = db.prepare(
      'SELECT action, details FROM activity_log WHERE agent_id = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT 5'
    ).all(agent.id, fromTime) as any[];

    return {
      agentId: agent.id,
      name: agent.name,
      emoji: agent.emoji,
      tasksCompleted: completed,
      tasksFailed: failed,
      lastActive: agent.updated_at,
      actions: recentActions.map(a => `${a.action}: ${(a.details || '').substring(0, 80)}`),
    };
  });
}

// ---------------------------------------------------------------------------
// Internal: Get task summary
// ---------------------------------------------------------------------------

function getTaskSummary(fromTime: string): TaskSummary {
  const total = (db.prepare(
    "SELECT COUNT(*) as c FROM tasks WHERE created_at >= ?"
  ).get(fromTime) as any)?.c || 0;

  const completed = (db.prepare(
    "SELECT COUNT(*) as c FROM tasks WHERE status IN ('completed', 'done') AND completed_at >= ?"
  ).get(fromTime) as any)?.c || 0;

  const failed = (db.prepare(
    "SELECT COUNT(*) as c FROM tasks WHERE status = 'failed' AND created_at >= ?"
  ).get(fromTime) as any)?.c || 0;

  const inProgress = (db.prepare(
    "SELECT COUNT(*) as c FROM tasks WHERE status IN ('in_progress', 'running') AND created_at >= ?"
  ).get(fromTime) as any)?.c || 0;

  const avgCompletion = db.prepare(`
    SELECT AVG(
      (julianday(completed_at) - julianday(created_at)) * 24 * 60
    ) as avg_min
    FROM tasks
    WHERE completed_at IS NOT NULL AND created_at >= ?
  `).get(fromTime) as any;

  const topDescs = db.prepare(
    "SELECT description FROM tasks WHERE created_at >= ? ORDER BY created_at DESC LIMIT 5"
  ).all(fromTime) as any[];

  return {
    total,
    completed,
    failed,
    inProgress,
    avgCompletionMinutes: avgCompletion?.avg_min || 0,
    topDescriptions: topDescs.map(t => t.description.substring(0, 100)),
  };
}

// ---------------------------------------------------------------------------
// Internal: Get workflow summary
// ---------------------------------------------------------------------------

function getWorkflowSummary(fromTime: string): WorkflowSummary {
  const rows = db.prepare(`
    SELECT status, COUNT(*) as c FROM workflows
    WHERE created_at >= ?
    GROUP BY status
  `).all(fromTime) as any[];

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = r.c;

  return {
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    completed: counts['completed'] || 0,
    failed: counts['failed'] || 0,
    running: counts['running'] || 0,
  };
}

// ---------------------------------------------------------------------------
// Internal: Get SRE summary
// ---------------------------------------------------------------------------

function getSreSummary(fromTime: string): SreSummary {
  const checks = db.prepare(
    "SELECT COUNT(*) as c, AVG(cpu) as avg_cpu, AVG(memory) as avg_mem, AVG(disk) as avg_disk FROM sre_checks WHERE timestamp >= ?"
  ).get(fromTime) as any;

  const alerts = (db.prepare(
    "SELECT COUNT(*) as c FROM sre_alert_history WHERE triggered_at >= ?"
  ).get(fromTime) as any)?.c || 0;

  const resolved = (db.prepare(
    "SELECT COUNT(*) as c FROM sre_alert_history WHERE triggered_at >= ? AND acknowledged = 1"
  ).get(fromTime) as any)?.c || 0;

  return {
    checksRun: checks?.c || 0,
    alertsTriggered: alerts,
    incidentsResolved: resolved,
    avgCpu: checks?.avg_cpu || 0,
    avgMemory: checks?.avg_mem || 0,
    avgDisk: checks?.avg_disk || 0,
  };
}

// ---------------------------------------------------------------------------
// Internal: Get cost summary
// ---------------------------------------------------------------------------

function getCostSummary(fromTime: string): CostSummary {
  const totals = db.prepare(
    "SELECT SUM(total_tokens) as tokens, SUM(cost_usd) as cost FROM agent_usage WHERE recorded_at >= ?"
  ).get(fromTime) as any;

  const byAgent = db.prepare(`
    SELECT agent_id, SUM(total_tokens) as tokens, SUM(cost_usd) as cost
    FROM agent_usage WHERE recorded_at >= ?
    GROUP BY agent_id ORDER BY cost DESC
  `).all(fromTime) as any[];

  return {
    totalCost: totals?.cost || 0,
    totalTokens: totals?.tokens || 0,
    byAgent: byAgent.map(a => ({
      agentId: a.agent_id,
      cost: a.cost,
      tokens: a.tokens,
    })),
  };
}

// ---------------------------------------------------------------------------
// Internal: Get checkpoint summary
// ---------------------------------------------------------------------------

function getCheckpointSummary(fromTime: string): CheckpointSummary {
  const pending = (db.prepare(
    "SELECT COUNT(*) as c FROM checkpoints WHERE status = 'pending'"
  ).get() as any)?.c || 0;

  const approved = (db.prepare(
    "SELECT COUNT(*) as c FROM checkpoints WHERE status = 'approved' AND responded_at >= ?"
  ).get(fromTime) as any)?.c || 0;

  const rejected = (db.prepare(
    "SELECT COUNT(*) as c FROM checkpoints WHERE status = 'rejected' AND responded_at >= ?"
  ).get(fromTime) as any)?.c || 0;

  return { pending, approved, rejected };
}

// ---------------------------------------------------------------------------
// Internal: Build highlight messages
// ---------------------------------------------------------------------------

function buildHighlights(
  agents: AgentActivitySummary[],
  tasks: TaskSummary,
  workflows: WorkflowSummary,
  sre: SreSummary,
  cost: CostSummary,
  checkpoints: CheckpointSummary,
  hours: number
): string[] {
  const highlights: string[] = [];

  if (tasks.total === 0) {
    highlights.push(`No tasks ran in the last ${hours}h — all quiet`);
    return highlights;
  }

  if (tasks.completed > 0) {
    highlights.push(`${tasks.completed} task(s) completed successfully`);
  }
  if (tasks.failed > 0) {
    highlights.push(`⚠️ ${tasks.failed} task(s) failed — may need attention`);
  }

  if (workflows.completed > 0) {
    highlights.push(`${workflows.completed} workflow(s) finished`);
  }
  if (workflows.running > 0) {
    highlights.push(`${workflows.running} workflow(s) still running`);
  }

  if (sre.alertsTriggered > 0) {
    highlights.push(`🚨 ${sre.alertsTriggered} SRE alert(s) triggered`);
  }
  if (sre.avgCpu > 80) {
    highlights.push(`⚠️ High avg CPU: ${Math.round(sre.avgCpu)}%`);
  }

  if (checkpoints.pending > 0) {
    highlights.push(`⏸️ ${checkpoints.pending} checkpoint(s) awaiting your approval`);
  }

  // Identify most active agent
  const mostActive = agents.reduce((a, b) =>
    (a.tasksCompleted + a.tasksFailed) > (b.tasksCompleted + b.tasksFailed) ? a : b
  );
  if (mostActive.tasksCompleted > 0) {
    highlights.push(`${mostActive.emoji} ${mostActive.name} was the most active (${mostActive.tasksCompleted} tasks)`);
  }

  return highlights;
}
