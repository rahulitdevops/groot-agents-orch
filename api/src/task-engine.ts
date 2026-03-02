import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { publishEvent } from './redis.js';
import { getRoutingBoost } from './agent-performance.js';
import { getMemoryContextForTask } from './shared-memory.js';
import { recordPerformance } from './agent-performance.js';
import { onWorkflowTaskCompleted } from './workflow-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.resolve(__dirname, '../../agents');
const QUEUE_FILE = path.resolve(__dirname, '../../task-queue.json');

// ---------------------------------------------------------------------------
// Agent definitions for intelligent routing
// ---------------------------------------------------------------------------
interface AgentProfile {
  id: string;
  description: string;
  strengths: string[];
  when: string;
  notWhen: string;
}

const AGENT_PROFILES: AgentProfile[] = [
  {
    id: 'builder',
    description: 'Builds features, writes code, creates UI, deploys',
    strengths: ['coding', 'frontend', 'backend', 'UI/UX', 'deployment', 'refactoring', 'migration'],
    when: 'Building new features, fixing code issues, UI changes, refactoring, creating components, deployment',
    notWhen: 'Diagnosing unknown bugs (use debugger), testing (use qa), research-only tasks (use researcher)',
  },
  {
    id: 'researcher',
    description: 'Deep research, comparisons, analysis, finding information',
    strengths: ['research', 'analysis', 'comparison', 'learning', 'benchmarking', 'summarization'],
    when: 'Research questions, comparing options, market analysis, learning about new tech, finding best practices',
    notWhen: 'Code implementation (use builder), bug fixes (use debugger)',
  },
  {
    id: 'debugger',
    description: 'Traces bugs, root cause analysis, minimal targeted fixes',
    strengths: ['debugging', 'error tracing', 'root cause analysis', 'performance profiling'],
    when: 'Something is broken, errors occurring, crashes, performance issues, "not working" scenarios',
    notWhen: 'Building new features (use builder), writing tests (use qa)',
  },
  {
    id: 'qa',
    description: 'Testing, verification, quality assurance',
    strengths: ['testing', 'verification', 'quality checks', 'regression testing', 'smoke tests'],
    when: 'After code changes, before deployments, verifying fixes, running test suites, quality checks',
    notWhen: 'Implementing fixes (use builder/debugger), research (use researcher)',
  },
  {
    id: 'pm',
    description: 'Product specs, roadmaps, planning, user stories',
    strengths: ['planning', 'specifications', 'roadmaps', 'user stories', 'prioritization', 'product thinking'],
    when: 'Planning features, writing specs, creating roadmaps, defining requirements, user story creation',
    notWhen: 'Code implementation (use builder), testing (use qa)',
  },
  {
    id: 'sre',
    description: 'Infrastructure monitoring, health checks, uptime, self-healing',
    strengths: ['monitoring', 'infrastructure', 'health checks', 'alerts', 'resource management', 'self-healing'],
    when: 'Server health, monitoring, infra issues, resource alerts, service restarts, uptime checks',
    notWhen: 'Application bugs (use debugger), new features (use builder)',
  },
];

// ---------------------------------------------------------------------------
// Smart routing — intent-based with scoring heuristics
// ---------------------------------------------------------------------------

/** Intent signals extracted from the task description */
interface IntentSignals {
  isBroken: boolean;         // something is broken/erroring
  isNew: boolean;            // building something new
  isResearch: boolean;       // research/comparison/learning
  isVerification: boolean;   // testing/verification
  isPlanning: boolean;       // planning/spec/design
  isInfra: boolean;          // infrastructure/monitoring
  isMultiStep: boolean;      // likely needs multiple agents
  urgency: 'low' | 'medium' | 'high';
}

function extractIntentSignals(description: string): IntentSignals {
  const lower = description.toLowerCase();

  const brokenPatterns = /\b(broken|crash|error|bug|not working|failing|down|500|404|exception|undefined|null pointer|stuck|hang|freeze|timeout)\b/;
  const newPatterns = /\b(build|building|create|creating|implement|implementing|add|adding|new|set up|setting up|integrate|integrating|develop|developing|make|making|setup|scaffold|scaffolding|write|writing|design|designing|generate|generating)\b/;
  const researchPatterns = /\b(research|find out|compare|analyze|explore|investigate|learn|study|benchmark|what is|how does|look into|alternatives)\b/;
  const verifyPatterns = /\b(test|verify|check|validate|qa|quality|regression|smoke|ensure|confirm|works)\b/;
  const planPatterns = /\b(plan|roadmap|spec|design|feature request|requirement|user story|prioritize|scope|product)\b/;
  const infraPatterns = /\b(monitor|alert|uptime|health|infra|server|cpu|memory|disk|deploy|restart|incident|latency)\b/;
  const multiStepPatterns = /\b(and then|then|after that|first.*then|research.*build|fix.*test|build.*test|deploy.*monitor|workflow|pipeline|step by step|show.*steps|steps.*before|authenticate|authentication|authorization|oauth|login system|user auth|sign.?in system|onboarding|full.?stack|end.?to.?end|e2e|integration)\b/;
  const urgentPatterns = /\b(urgent|asap|emergency|critical|immediately|now|production down)\b/;

  return {
    isBroken: brokenPatterns.test(lower),
    isNew: newPatterns.test(lower) && !brokenPatterns.test(lower),
    isResearch: researchPatterns.test(lower),
    isVerification: verifyPatterns.test(lower) && !brokenPatterns.test(lower),
    isPlanning: planPatterns.test(lower),
    isInfra: infraPatterns.test(lower),
    isMultiStep: multiStepPatterns.test(lower),
    urgency: urgentPatterns.test(lower) ? 'high' : 'medium',
  };
}

function scoreAgent(profile: AgentProfile, signals: IntentSignals, description: string): number {
  let score = 0;
  const lower = description.toLowerCase();

  // Intent-based scoring (weighted heavily)
  if (signals.isBroken && profile.id === 'debugger') score += 10;
  if (signals.isBroken && profile.id === 'builder') score += 3; // builder can fix too, but debugger is better
  if (signals.isNew && profile.id === 'builder') score += 10;
  if (signals.isResearch && profile.id === 'researcher') score += 10;
  if (signals.isVerification && profile.id === 'qa') score += 10;
  if (signals.isPlanning && profile.id === 'pm') score += 10;
  if (signals.isInfra && profile.id === 'sre') score += 10;

  // Secondary keyword matching (light weight, tiebreaker)
  for (const strength of profile.strengths) {
    if (lower.includes(strength.toLowerCase())) score += 1;
  }

  // Context-aware boosts
  if (lower.includes('deploy') && profile.id === 'builder') score += 5;
  if (lower.includes('deploy') && profile.id === 'sre') score += 3;
  if ((lower.includes('slow') || lower.includes('performance')) && profile.id === 'debugger') score += 5;
  if (lower.includes('after') && lower.includes('test') && profile.id === 'qa') score += 3;

  return score;
}

export function autoAssign(description: string): string {
  const signals = extractIntentSignals(description);
  let bestAgent = 'builder'; // default fallback
  let bestScore = 0;

  for (const profile of AGENT_PROFILES) {
    let score = scoreAgent(profile, signals, description);
    // Apply performance-based routing boost (-3 to +3)
    const boost = getRoutingBoost(profile.id, description);
    score += boost;
    if (score > bestScore) {
      bestScore = score;
      bestAgent = profile.id;
    }
  }

  console.log(`[TaskEngine] Smart routing: "${description.substring(0, 80)}..." → ${bestAgent} (score: ${bestScore}, signals: ${JSON.stringify(signals)})`);
  return bestAgent;
}

/**
 * For multi-step tasks, generate a suggested pipeline.
 * Returns an array of { agent, task } steps. If single-step, returns one entry.
 */
function agentFromClause(clause: string): string {
  const lower = clause.toLowerCase();
  if (/\b(research|find|compare|analyze|look up|investigate|survey|top|best)\b/.test(lower)) return 'researcher';
  if (/\b(spec|specification|feature spec|plan|document|design|write|draft|proposal)\b/.test(lower)) return 'pm';
  if (/\b(build|implement|create|develop|code|proof.of.concept|poc|add|make|integrate)\b/.test(lower)) return 'builder';
  if (/\b(test|qa|verify|pass|fail|quality|check|report)\b/.test(lower)) return 'qa';
  if (/\b(deploy|release|ship|rollout|launch)\b/.test(lower)) return 'sre';
  if (/\b(debug|fix|diagnose|troubleshoot)\b/.test(lower)) return 'debugger';
  return 'builder';
}

export function suggestPipeline(description: string): Array<{ agent: string; task: string; step: number }> {
  // Explicit "then" chaining takes priority over pattern matching
  // e.g. "research X, then write spec, then build it, then QA test"
  const thenParts = description.split(/,?\s+then\s+/i).map(s => s.trim()).filter(Boolean);
  if (thenParts.length >= 3) {
    return thenParts.map((clause, i) => ({
      step: i + 1,
      agent: agentFromClause(clause),
      task: clause,
    }));
  }

  const signals = extractIntentSignals(description);

  // Multi-step detection
  if (signals.isMultiStep) {
    const lower = description.toLowerCase();

    // Research → Build pattern
    if (signals.isResearch && signals.isNew) {
      return [
        { step: 1, agent: 'researcher', task: `Research: ${description}` },
        { step: 2, agent: 'builder', task: `Implement based on research findings: ${description}` },
        { step: 3, agent: 'qa', task: `Test the implementation: ${description}` },
      ];
    }

    // Fix → Test pattern
    if (signals.isBroken && signals.isVerification) {
      return [
        { step: 1, agent: 'debugger', task: `Debug and fix: ${description}` },
        { step: 2, agent: 'qa', task: `Verify the fix: ${description}` },
      ];
    }

    // Deploy pattern
    if (lower.includes('deploy')) {
      return [
        { step: 1, agent: 'builder', task: `Deploy: ${description}` },
        { step: 2, agent: 'sre', task: `Monitor deployment: ${description}` },
        { step: 3, agent: 'qa', task: `Smoke test after deploy: ${description}` },
      ];
    }

    // New feature / build pipeline (default multi-step for new things)
    if (signals.isNew) {
      return [
        { step: 1, agent: 'pm', task: `Write spec for: ${description}` },
        { step: 2, agent: 'builder', task: `Implement: ${description}` },
        { step: 3, agent: 'qa', task: `Test and verify: ${description}` },
      ];
    }

    // Research or planning pipeline
    if (signals.isResearch || signals.isPlanning) {
      return [
        { step: 1, agent: 'researcher', task: `Research: ${description}` },
        { step: 2, agent: 'pm', task: `Spec from research: ${description}` },
      ];
    }

    // Fix without explicit test request
    if (signals.isBroken) {
      return [
        { step: 1, agent: 'debugger', task: `Debug and fix: ${description}` },
        { step: 2, agent: 'qa', task: `Verify the fix: ${description}` },
      ];
    }
  }

  // Single-step: just route to best agent
  const bestAgent = autoAssign(description);
  return [{ step: 1, agent: bestAgent, task: description }];
}

// ---------------------------------------------------------------------------
// Read agent config
// ---------------------------------------------------------------------------
function readAgentConfig(agentId: string): string {
  const claudePath = path.join(AGENTS_DIR, agentId, 'CLAUDE.md');
  try { return fs.readFileSync(claudePath, 'utf-8'); } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Task complexity → model selection (token optimization)
// ---------------------------------------------------------------------------
type TaskComplexity = 'light' | 'medium' | 'heavy';

function assessComplexity(description: string, agentId: string): TaskComplexity {
  const lower = description.toLowerCase();
  const wordCount = description.split(/\s+/).length;

  // Heavy: multi-file refactors, architecture decisions, complex debugging
  const heavyPatterns = /\b(refactor|architect|redesign|migrate|rewrite|complex|multi.?file|full.?stack|production.?incident|root.?cause)\b/;
  if (heavyPatterns.test(lower) || wordCount > 80) return 'heavy';

  // Light: status checks, simple queries, formatting, health checks
  const lightPatterns = /\b(status|check|list|show|format|rename|typo|log|ping|health|uptime|restart|simple|quick)\b/;
  if (lightPatterns.test(lower) && wordCount < 30) return 'light';
  if (agentId === 'sre') return 'light'; // SRE tasks are mostly monitoring

  return 'medium';
}

const COMPLEXITY_MODEL_MAP: Record<TaskComplexity, string> = {
  light: 'haiku',
  medium: 'sonnet',
  heavy: 'opus',
};

function selectModelForTask(agentId: string, description: string): string {
  // Groot supervisor always uses opus for routing decisions
  if (agentId === 'groot') return 'opus';

  const complexity = assessComplexity(description, agentId);
  const model = COMPLEXITY_MODEL_MAP[complexity];
  console.log(`[TaskEngine] Complexity: ${complexity} → model: ${model} for ${agentId}`);
  return model;
}

// Token efficiency directive appended to all agent prompts
const TOKEN_EFFICIENCY_DIRECTIVE = `

--- Output Guidelines ---
Be concise. Deliver results directly without preamble or repetition.
Prefer structured output (bullet points, code blocks) over prose.
Skip explanations the user didn't ask for. No filler phrases.
--- End Guidelines ---`;


// ---------------------------------------------------------------------------
// Queue management
// ---------------------------------------------------------------------------
interface QueueEntry {
  taskId: number;
  agentId: string;
  description: string;
  status: 'queued' | 'executing' | 'done' | 'failed';
  createdAt: string;
}

function readQueue(): QueueEntry[] {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8')); } catch { return []; }
}

function writeQueue(queue: QueueEntry[]) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

function addToQueue(entry: QueueEntry) {
  const queue = readQueue();
  if (queue.some(q => q.taskId === entry.taskId)) return;
  queue.push(entry);
  writeQueue(queue);
}

function removeFromQueue(taskId: number) {
  writeQueue(readQueue().filter(q => q.taskId !== taskId));
}

function updateQueueStatus(taskId: number, status: QueueEntry['status']) {
  const queue = readQueue();
  const entry = queue.find(q => q.taskId === taskId);
  if (entry) entry.status = status;
  writeQueue(queue);
}

// ---------------------------------------------------------------------------
// Bridge reference
// ---------------------------------------------------------------------------
let bridge: any = null;
export function setBridge(b: any) { bridge = b; }

function isAgentBusy(agentId: string): boolean {
  const agent = db.prepare('SELECT status FROM agents WHERE id = ?').get(agentId) as any;
  return agent?.status === 'running' || agent?.status === 'working';
}

// ---------------------------------------------------------------------------
// Budget guardrails — prevent runaway spend
// ---------------------------------------------------------------------------
const DAILY_BUDGET_LIMIT = 10;   // $10/day hard cap
const MONTHLY_BUDGET_LIMIT = 100; // $100/month (Claude Max plan)

function checkBudget(): { ok: boolean; reason?: string; todayCost: number; monthCost: number } {
  const today = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as cost FROM agent_usage WHERE date(recorded_at) = date('now')"
  ).get() as any;
  const month = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as cost FROM agent_usage WHERE recorded_at >= date('now', 'start of month')"
  ).get() as any;

  const todayCost = today?.cost || 0;
  const monthCost = month?.cost || 0;

  if (monthCost >= MONTHLY_BUDGET_LIMIT) {
    return { ok: false, reason: `Monthly budget exhausted ($${monthCost.toFixed(2)}/$${MONTHLY_BUDGET_LIMIT})`, todayCost, monthCost };
  }
  if (todayCost >= DAILY_BUDGET_LIMIT) {
    return { ok: false, reason: `Daily budget exhausted ($${todayCost.toFixed(2)}/$${DAILY_BUDGET_LIMIT})`, todayCost, monthCost };
  }
  return { ok: true, todayCost, monthCost };
}

// ---------------------------------------------------------------------------
// Get previous task output for context chaining (Quick Win #3)
// ---------------------------------------------------------------------------
function getPreviousTaskContext(agentId: string, description: string): string {
  // Find the most recent completed task that's related (same conversation/pipeline)
  // Look for tasks completed in the last 30 minutes that could provide context
  const recentTasks = db.prepare(`
    SELECT agent_id, description, output, completed_at
    FROM tasks
    WHERE status = 'completed'
      AND output IS NOT NULL
      AND output != ''
      AND completed_at > datetime('now', '-30 minutes')
    ORDER BY completed_at DESC
    LIMIT 3
  `).all() as any[];

  if (recentTasks.length === 0) return '';

  // Build context from recent agent outputs
  const contextParts: string[] = [];
  for (const task of recentTasks) {
    const preview = task.output.substring(0, 500);
    contextParts.push(`[Previous: ${task.agent_id} completed "${task.description.substring(0, 100)}"]\n${preview}`);
  }

  return contextParts.length > 0
    ? `\n\n--- Recent Agent Context ---\n${contextParts.join('\n\n')}\n--- End Context ---\n`
    : '';
}

// ---------------------------------------------------------------------------
// Execute a task (with output chaining — Quick Win #3)
// ---------------------------------------------------------------------------
export async function executeTask(taskId: number, agentId: string, description: string): Promise<{ method: 'ws' | 'queue' | 'blocked'; success: boolean; reason?: string }> {
  // Budget guardrail check
  const budget = checkBudget();
  if (!budget.ok) {
    console.warn(`[TaskEngine] Budget exceeded, blocking task #${taskId}: ${budget.reason}`);
    db.prepare("UPDATE tasks SET status = 'failed', output = ? WHERE id = ?").run(`Blocked: ${budget.reason}`, taskId);
    publishEvent('groot:task', { type: 'task:update', taskId, status: 'failed', reason: budget.reason });
    return { method: 'blocked', success: false, reason: budget.reason };
  }

  const agentConfig = readAgentConfig(agentId);
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
  const agentName = agent?.name || agentId;
  const agentEmoji = agent?.emoji || '🤖';

  // Get context from previous tasks (output chaining)
  const previousContext = getPreviousTaskContext(agentId, description);

  // Get shared memory context (Longer-Term Improvement #2)
  const memoryContext = getMemoryContextForTask(agentId, description);

  // Select model based on task complexity (token optimization)
  const selectedModel = selectModelForTask(agentId, description);

  const taskPrompt = agentConfig
    ? `You are ${agentEmoji} ${agentName}.\n\n${agentConfig}${TOKEN_EFFICIENCY_DIRECTIVE}${memoryContext}${previousContext}\n\nTask: ${description}`
    : `You are ${agentEmoji} ${agentName}.${TOKEN_EFFICIENCY_DIRECTIVE}${memoryContext}${previousContext}\n\nTask: ${description}`;
  const label = `${agentId}-task-${taskId}`;

  db.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").run(taskId);
  db.prepare("UPDATE agents SET status = 'running', last_task = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?")
    .run(description.substring(0, 200), agentId);
  db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)')
    .run(agentId, 'task_executing', `Task #${taskId}: ${description.substring(0, 200)}`);
  publishEvent('groot:agent', { type: 'agent:status', agentId, status: 'running', label: description.substring(0, 200) });
  publishEvent('groot:task', { type: 'task:update', taskId, status: 'in_progress' });

  // Try WS spawn
  if (bridge?.connected) {
    try {
      const result = await bridge.sendRequest('sessions.spawn', { task: taskPrompt, label, mode: 'run', model: selectedModel });
      console.log(`[TaskEngine] WS spawn succeeded for task #${taskId} (model: ${selectedModel}):`, JSON.stringify(result).substring(0, 200));
      updateQueueStatus(taskId, 'executing');
      return { method: 'ws', success: true };
    } catch (err: any) {
      console.warn(`[TaskEngine] WS spawn failed for task #${taskId}:`, err.message);
    }
  }

  // Fallback: queue file
  console.log(`[TaskEngine] Falling back to queue file for task #${taskId}`);
  addToQueue({ taskId, agentId, description, status: 'queued', createdAt: new Date().toISOString() });
  return { method: 'queue', success: true };
}

// ---------------------------------------------------------------------------
// Process new task (called from POST /api/tasks)
// ---------------------------------------------------------------------------
export async function processNewTask(
  taskId: number, agentId: string, description: string, runNow: boolean
): Promise<{ agentId: string; queued: boolean; method?: string }> {
  const finalAgent = (!agentId || agentId === 'auto') ? autoAssign(description) : agentId;
  if (finalAgent !== agentId) {
    db.prepare('UPDATE tasks SET agent_id = ? WHERE id = ?').run(finalAgent, taskId);
  }
  if (!runNow) return { agentId: finalAgent, queued: false };

  if (isAgentBusy(finalAgent)) {
    addToQueue({ taskId, agentId: finalAgent, description, status: 'queued', createdAt: new Date().toISOString() });
    console.log(`[TaskEngine] Agent ${finalAgent} busy, queued task #${taskId}`);
    return { agentId: finalAgent, queued: true };
  }

  try {
    const result = await executeTask(taskId, finalAgent, description);
    return { agentId: finalAgent, queued: false, method: result.method };
  } catch (err) {
    console.error(`[TaskEngine] Failed to execute task #${taskId}:`, err);
    return { agentId: finalAgent, queued: false };
  }
}

// ---------------------------------------------------------------------------
// Process queued tasks
// ---------------------------------------------------------------------------
export async function processQueue() {
  const queue = readQueue().filter(q => q.status === 'queued');
  for (const entry of queue) {
    if (!isAgentBusy(entry.agentId)) {
      console.log(`[TaskEngine] Processing queued task #${entry.taskId} for ${entry.agentId}`);
      try { await executeTask(entry.taskId, entry.agentId, entry.description); }
      catch (err) { console.error(`[TaskEngine] Queue failed for #${entry.taskId}:`, err); updateQueueStatus(entry.taskId, 'failed'); }
    }
  }
}

// ---------------------------------------------------------------------------
// Post-task evaluation (Quick Win #5)
// ---------------------------------------------------------------------------
function evaluateTaskOutput(taskId: number, agentId: string, output: string): 'success' | 'partial' | 'failed' {
  if (!output || output.trim().length === 0) return 'failed';

  const lower = output.toLowerCase();

  // Check for explicit failure indicators
  const failurePatterns = /\b(error|failed|could not|unable to|exception|crash|fatal|permission denied|not found)\b/;
  const successPatterns = /\b(completed|done|fixed|deployed|created|updated|passed|verified|success|✅)\b/;
  const blockedPatterns = /\b(blocked|need more info|clarification needed|ambiguous|can't proceed|waiting)\b/;

  const failureHits = (lower.match(failurePatterns) || []).length;
  const successHits = (lower.match(successPatterns) || []).length;
  const blockedHits = (lower.match(blockedPatterns) || []).length;

  if (blockedHits > 0 && successHits === 0) return 'partial';
  if (failureHits > successHits) return 'failed';
  if (successHits > 0) return 'success';

  // If output exists but no clear signals, assume partial success
  return output.length > 100 ? 'success' : 'partial';
}

// ---------------------------------------------------------------------------
// On task completion (with evaluation — Quick Win #5)
// ---------------------------------------------------------------------------
export function onTaskCompleted(taskId: number, output?: string) {
  if (output) db.prepare('UPDATE tasks SET output = ? WHERE id = ?').run(output, taskId);

  // Post-completion evaluation
  const task = db.prepare('SELECT agent_id, description, created_at FROM tasks WHERE id = ?').get(taskId) as any;
  if (task) {
    const evaluation = output
      ? evaluateTaskOutput(taskId, task.agent_id, output)
      : 'success'; // No output but completed = assume success (WS sessions)

    if (output) {
      console.log(`[TaskEngine] Task #${taskId} evaluation: ${evaluation}`);

      db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)')
        .run(task.agent_id, 'task_evaluated', `Task #${taskId}: ${evaluation} — ${task.description.substring(0, 100)}`);

      // Log evaluation as event for dashboard
      publishEvent('groot:task', {
        type: 'task:evaluated',
        taskId,
        agentId: task.agent_id,
        evaluation,
        outputPreview: output.substring(0, 200),
      });

      // If task failed or partial, log for Groot to review
      if (evaluation === 'failed') {
        console.warn(`[TaskEngine] ⚠️ Task #${taskId} appears to have FAILED. Agent: ${task.agent_id}. Consider retry or different agent.`);
        db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)')
          .run('groot', 'task_needs_review', `Task #${taskId} by ${task.agent_id} may have failed: ${output.substring(0, 200)}`);
      }
    }

    // Record performance for agent self-improvement (Longer-Term Improvement #3)
    const durationMs = task.created_at
      ? Date.now() - new Date(task.created_at).getTime()
      : undefined;
    try {
      recordPerformance(task.agent_id, taskId, task.description, evaluation, durationMs);
    } catch (err) {
      console.warn(`[TaskEngine] Failed to record performance for task #${taskId}:`, err);
    }

    // Notify workflow engine if this task is part of a workflow (Longer-Term Improvement #1 + #4)
    try {
      onWorkflowTaskCompleted(taskId, output);
    } catch (err) {
      console.warn(`[TaskEngine] Failed to notify workflow engine for task #${taskId}:`, err);
    }
  }

  removeFromQueue(taskId);
  processQueue().catch(console.error);
}

export function getQueueStatus(): QueueEntry[] { return readQueue(); }
