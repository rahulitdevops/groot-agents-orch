/**
 * Agent Self-Improvement — Performance tracking + skill evolution
 *
 * Makes the existing agent_skills table functional by:
 * 1. Recording success/failure per agent per task type
 * 2. Using historical performance to influence routing decisions
 * 3. Evolving XP/levels based on actual task outcomes
 * 4. Identifying weak spots and suggesting improvements
 *
 * Longer-Term Improvement #3
 */

import db from './db.js';
import { publishEvent } from './redis.js';

// ---------------------------------------------------------------------------
// Task type categorization
// ---------------------------------------------------------------------------

const TASK_TYPE_PATTERNS: Record<string, RegExp> = {
  build:     /\b(build|create|implement|add|feature|component|scaffold|setup|new)\b/i,
  debug:     /\b(debug|fix|bug|error|broken|crash|not working|trace|root cause)\b/i,
  test:      /\b(test|verify|qa|check|validate|regression|smoke|ensure)\b/i,
  research:  /\b(research|find|compare|analyze|explore|investigate|learn|benchmark)\b/i,
  plan:      /\b(plan|spec|design|roadmap|requirement|user story|prioritize|scope)\b/i,
  monitor:   /\b(monitor|health|uptime|alert|cpu|memory|disk|infra|deploy)\b/i,
  refactor:  /\b(refactor|clean|optimize|improve|restructure|migrate|upgrade)\b/i,
  review:    /\b(review|audit|assess|evaluate|code review)\b/i,
};

export function categorizeTask(description: string): string {
  for (const [type, pattern] of Object.entries(TASK_TYPE_PATTERNS)) {
    if (pattern.test(description)) return type;
  }
  return 'general';
}

// ---------------------------------------------------------------------------
// Record task performance
// ---------------------------------------------------------------------------

export function recordPerformance(
  agentId: string,
  taskId: number,
  description: string,
  evaluation: 'success' | 'partial' | 'failed',
  durationMs?: number
): void {
  const taskType = categorizeTask(description);

  db.prepare(`
    INSERT INTO agent_performance (agent_id, task_type, evaluation, task_id, duration_ms)
    VALUES (?, ?, ?, ?, ?)
  `).run(agentId, taskType, evaluation, taskId, durationMs || null);

  // Update skill XP based on evaluation
  const xpGain = evaluation === 'success' ? 25 : evaluation === 'partial' ? 10 : -5;
  updateSkillXp(agentId, taskType, xpGain, taskId);

  console.log(`[AgentPerf] ${agentId}: ${taskType} → ${evaluation} (XP: ${xpGain > 0 ? '+' : ''}${xpGain})`);
}

// ---------------------------------------------------------------------------
// Update skill XP from task performance
// ---------------------------------------------------------------------------

function taskTypeToSkill(agentId: string, taskType: string): string | null {
  // Map task types to the most relevant skill for each agent
  const skillMap: Record<string, Record<string, string>> = {
    builder:    { build: 'Next.js', debug: 'TypeScript', refactor: 'React', test: 'Node.js' },
    debugger:   { debug: 'Error Tracing', build: 'Root Cause Analysis', test: 'Stack Traces' },
    qa:         { test: 'Build Verification', build: 'API Testing', debug: 'Integration Testing' },
    researcher: { research: 'Web Research', plan: 'Technical Analysis', review: 'Documentation' },
    pm:         { plan: 'Product Specs', review: 'User Stories', research: 'Feature Prioritization' },
    sre:        { monitor: 'Health Monitoring', debug: 'Service Checks', build: 'Alert Management' },
  };

  return skillMap[agentId]?.[taskType] || null;
}

function updateSkillXp(agentId: string, taskType: string, xpGain: number, taskId: number): void {
  const skillName = taskTypeToSkill(agentId, taskType);
  if (!skillName) return;

  const skill = db.prepare(
    'SELECT * FROM agent_skills WHERE agent_id = ? AND skill = ?'
  ).get(agentId, skillName) as any;

  if (!skill) return;

  const newXp = Math.max(0, skill.xp + xpGain);
  const oldLevel = skill.level;
  const newLevel = getLevelForXp(newXp);

  db.prepare(`
    UPDATE agent_skills
    SET xp = ?, level = ?, times_used = times_used + 1, last_used = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE agent_id = ? AND skill = ?
  `).run(newXp, newLevel, agentId, skillName);

  if (newLevel !== oldLevel) {
    db.prepare(`
      INSERT INTO agent_skill_log (agent_id, skill, action, old_level, new_level, xp_gained, task_id)
      VALUES (?, ?, 'leveled_up', ?, ?, ?, ?)
    `).run(agentId, skillName, oldLevel, newLevel, xpGain, taskId);

    publishEvent('groot:agent', {
      type: 'agent:level_up',
      agentId,
      skill: skillName,
      oldLevel,
      newLevel,
      xp: newXp,
    });

    console.log(`[AgentPerf] 🎉 ${agentId} leveled up "${skillName}": ${oldLevel} → ${newLevel}`);
  }
}

function getLevelForXp(xp: number): string {
  if (xp >= 1500) return 'expert';
  if (xp >= 500) return 'advanced';
  if (xp >= 100) return 'intermediate';
  return 'beginner';
}

// ---------------------------------------------------------------------------
// Get agent performance stats (for routing decisions)
// ---------------------------------------------------------------------------

export interface AgentStats {
  agentId: string;
  taskType: string;
  total: number;
  successes: number;
  partials: number;
  failures: number;
  successRate: number;
  avgDurationMs: number;
}

export function getAgentStats(agentId: string, taskType?: string): AgentStats[] {
  let sql = `
    SELECT agent_id, task_type,
      COUNT(*) as total,
      SUM(CASE WHEN evaluation = 'success' THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN evaluation = 'partial' THEN 1 ELSE 0 END) as partials,
      SUM(CASE WHEN evaluation = 'failed' THEN 1 ELSE 0 END) as failures,
      AVG(duration_ms) as avg_duration_ms
    FROM agent_performance
    WHERE agent_id = ?
  `;
  const params: any[] = [agentId];
  if (taskType) { sql += ' AND task_type = ?'; params.push(taskType); }
  sql += ' GROUP BY agent_id, task_type ORDER BY total DESC';

  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(r => ({
    agentId: r.agent_id,
    taskType: r.task_type,
    total: r.total,
    successes: r.successes,
    partials: r.partials,
    failures: r.failures,
    successRate: r.total > 0 ? r.successes / r.total : 0,
    avgDurationMs: r.avg_duration_ms || 0,
  }));
}

// ---------------------------------------------------------------------------
// Performance-aware routing boost
// ---------------------------------------------------------------------------

/**
 * Returns a routing score adjustment based on historical performance.
 * Used by autoAssign() to prefer agents with better track records.
 */
export function getRoutingBoost(agentId: string, description: string): number {
  const taskType = categorizeTask(description);
  const stats = getAgentStats(agentId, taskType);
  if (stats.length === 0) return 0;

  const stat = stats[0];
  if (stat.total < 3) return 0; // not enough data

  // Boost/penalize based on success rate
  if (stat.successRate >= 0.9) return 3;
  if (stat.successRate >= 0.7) return 1;
  if (stat.successRate < 0.3) return -3;
  if (stat.successRate < 0.5) return -1;

  return 0;
}

// ---------------------------------------------------------------------------
// Summary dashboard data
// ---------------------------------------------------------------------------

export function getPerformanceSummary(): {
  overall: { total: number; successRate: number };
  byAgent: Array<{ agentId: string; total: number; successRate: number; topType: string }>;
  weakSpots: Array<{ agentId: string; taskType: string; failRate: number; total: number }>;
  recentTrend: Array<{ date: string; successes: number; failures: number }>;
} {
  const overall = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN evaluation = 'success' THEN 1 ELSE 0 END) * 1.0 / MAX(COUNT(*), 1) as success_rate
    FROM agent_performance
  `).get() as any;

  const byAgent = db.prepare(`
    SELECT agent_id,
      COUNT(*) as total,
      SUM(CASE WHEN evaluation = 'success' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as success_rate,
      (SELECT task_type FROM agent_performance ap2
       WHERE ap2.agent_id = agent_performance.agent_id
       GROUP BY task_type ORDER BY COUNT(*) DESC LIMIT 1) as top_type
    FROM agent_performance
    GROUP BY agent_id
    ORDER BY total DESC
  `).all() as any[];

  const weakSpots = db.prepare(`
    SELECT agent_id, task_type,
      SUM(CASE WHEN evaluation = 'failed' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as fail_rate,
      COUNT(*) as total
    FROM agent_performance
    GROUP BY agent_id, task_type
    HAVING total >= 3 AND fail_rate > 0.3
    ORDER BY fail_rate DESC
    LIMIT 10
  `).all() as any[];

  const recentTrend = db.prepare(`
    SELECT date(recorded_at) as date,
      SUM(CASE WHEN evaluation = 'success' THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN evaluation = 'failed' THEN 1 ELSE 0 END) as failures
    FROM agent_performance
    WHERE recorded_at >= date('now', '-14 days')
    GROUP BY date(recorded_at)
    ORDER BY date ASC
  `).all() as any[];

  return {
    overall: {
      total: overall?.total || 0,
      successRate: overall?.success_rate || 0,
    },
    byAgent: byAgent.map(a => ({
      agentId: a.agent_id,
      total: a.total,
      successRate: a.success_rate,
      topType: a.top_type || 'general',
    })),
    weakSpots: weakSpots.map(w => ({
      agentId: w.agent_id,
      taskType: w.task_type,
      failRate: w.fail_rate,
      total: w.total,
    })),
    recentTrend: recentTrend.map(r => ({
      date: r.date,
      successes: r.successes,
      failures: r.failures,
    })),
  };
}
