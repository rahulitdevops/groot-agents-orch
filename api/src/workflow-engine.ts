/**
 * Workflow Engine — DAG-based task orchestration
 *
 * Enables Groot to create multi-step plans where steps can:
 * - Depend on other steps (DAG order)
 * - Run in parallel when no dependencies
 * - Have conditional branches ("only if previous step succeeded")
 * - Pause for human approval (checkpoints)
 *
 * Longer-Term Improvement #1
 */

import { randomUUID } from 'crypto';
import db from './db.js';
import { publishEvent } from './redis.js';
import { executeTask, autoAssign } from './task-engine.js';

// Avoid circular import (workflow-engine ← task-engine ← openclaw-ws ← task-engine)
// openclaw-ws registers this callback at startup via registerSessionKiller()
let _killSessionFn: ((taskId: number) => void) | null = null;
export function registerSessionKiller(fn: (taskId: number) => void): void {
  _killSessionFn = fn;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowStep {
  id: string;
  agentId: string;
  description: string;
  dependsOn?: string[];      // step IDs this depends on
  condition?: string;         // 'always' | 'on_success' | 'on_failure' — default 'on_success'
  checkpoint?: boolean;       // pause for human approval before running
  checkpointRisk?: string;    // risk level for checkpoint
}

export interface WorkflowPlan {
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

export interface WorkflowStatus {
  id: string;
  name: string;
  status: string;
  steps: Array<{
    id: string;
    stepNumber: number;
    agentId: string;
    description: string;
    dependsOn: string[] | null;
    status: string;
    output: string | null;
    taskId: number | null;
  }>;
  progress: { total: number; completed: number; failed: number; running: number; pending: number };
}

// ---------------------------------------------------------------------------
// Create a workflow from a plan
// ---------------------------------------------------------------------------

export function createWorkflow(plan: WorkflowPlan, triggerTaskId?: number): string {
  const workflowId = `wf-${Date.now()}-${randomUUID().substring(0, 8)}`;

  db.prepare(`
    INSERT INTO workflows (id, name, description, status, trigger_task_id)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(workflowId, plan.name, plan.description || '', triggerTaskId || null);

  const insertStep = db.prepare(`
    INSERT INTO workflow_steps (id, workflow_id, step_number, agent_id, description, depends_on, status, condition)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `);

  const tx = db.transaction(() => {
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepId = step.id || `${workflowId}-step-${i + 1}`;
      const deps = step.dependsOn && step.dependsOn.length > 0
        ? JSON.stringify(step.dependsOn)
        : null;

      insertStep.run(
        stepId, workflowId, i + 1,
        step.agentId || autoAssign(step.description),
        step.description,
        deps,
        step.condition || 'on_success'
      );

      // Create checkpoint if requested
      if (step.checkpoint) {
        db.prepare(`
          INSERT INTO checkpoints (id, workflow_id, step_id, agent_id, description, risk_level, status)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `).run(
          `cp-${stepId}`,
          workflowId,
          stepId,
          step.agentId || 'groot',
          `Approve before: ${step.description}`,
          step.checkpointRisk || 'medium'
        );
      }
    }
  });
  tx();

  db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)')
    .run('groot', 'workflow_created', `Workflow ${workflowId}: ${plan.name} (${plan.steps.length} steps)`);

  publishEvent('groot:workflow', {
    type: 'workflow:created',
    workflowId,
    name: plan.name,
    stepCount: plan.steps.length,
  });

  console.log(`[WorkflowEngine] Created workflow ${workflowId}: "${plan.name}" with ${plan.steps.length} steps`);
  return workflowId;
}

// ---------------------------------------------------------------------------
// Start a workflow
// ---------------------------------------------------------------------------

export async function startWorkflow(workflowId: string): Promise<{ started: boolean; error?: string }> {
  const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
  if (!workflow) return { started: false, error: 'Workflow not found' };
  if (workflow.status === 'running') return { started: false, error: 'Workflow already running' };

  db.prepare(`UPDATE workflows SET status = 'running', started_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .run(workflowId);

  publishEvent('groot:workflow', { type: 'workflow:started', workflowId });
  console.log(`[WorkflowEngine] Starting workflow ${workflowId}`);

  // Advance the workflow — this will start any steps that have no dependencies
  await advanceWorkflow(workflowId);
  return { started: true };
}

// ---------------------------------------------------------------------------
// Advance workflow — find and execute ready steps
// ---------------------------------------------------------------------------

export async function advanceWorkflow(workflowId: string): Promise<void> {
  const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
  if (!workflow || workflow.status !== 'running') return;

  const steps = db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_number')
    .all(workflowId) as any[];

  // Check if workflow is complete
  const allDone = steps.every(s => ['completed', 'failed', 'skipped'].includes(s.status));
  if (allDone) {
    const hasFailed = steps.some(s => s.status === 'failed');
    const finalStatus = hasFailed ? 'failed' : 'completed';
    db.prepare(`UPDATE workflows SET status = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
      .run(finalStatus, workflowId);

    db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)')
      .run('groot', 'workflow_' + finalStatus, `Workflow ${workflowId}: ${workflow.name}`);

    publishEvent('groot:workflow', { type: 'workflow:completed', workflowId, status: finalStatus });
    console.log(`[WorkflowEngine] Workflow ${workflowId} ${finalStatus}`);
    return;
  }

  // Find steps that are ready to execute
  for (const step of steps) {
    if (step.status !== 'pending') continue;

    // Check dependencies
    const deps: string[] = step.depends_on ? JSON.parse(step.depends_on) : [];
    const depsResolved = deps.length === 0 || deps.every(depId => {
      const dep = steps.find(s => s.id === depId);
      if (!dep) return true; // missing dep = skip
      return dep.status === 'completed' || dep.status === 'skipped';
    });

    if (!depsResolved) continue;

    // Check condition
    if (step.condition === 'on_success' && deps.length > 0) {
      const allSucceeded = deps.every(depId => {
        const dep = steps.find(s => s.id === depId);
        return dep?.status === 'completed';
      });
      if (!allSucceeded) {
        db.prepare("UPDATE workflow_steps SET status = 'skipped' WHERE id = ?").run(step.id);
        console.log(`[WorkflowEngine] Skipping step ${step.id} — dependency failed (condition: on_success)`);
        continue;
      }
    }

    if (step.condition === 'on_failure' && deps.length > 0) {
      const anyFailed = deps.some(depId => {
        const dep = steps.find(s => s.id === depId);
        return dep?.status === 'failed';
      });
      if (!anyFailed) {
        db.prepare("UPDATE workflow_steps SET status = 'skipped' WHERE id = ?").run(step.id);
        continue;
      }
    }

    // Check for checkpoint
    const checkpoint = db.prepare(
      "SELECT * FROM checkpoints WHERE step_id = ? AND status = 'pending'"
    ).get(step.id) as any;

    if (checkpoint) {
      console.log(`[WorkflowEngine] Step ${step.id} blocked by checkpoint ${checkpoint.id} — waiting for approval`);
      db.prepare("UPDATE workflow_steps SET status = 'ready' WHERE id = ?").run(step.id);

      publishEvent('groot:checkpoint', {
        type: 'checkpoint:pending',
        checkpointId: checkpoint.id,
        workflowId,
        stepId: step.id,
        description: checkpoint.description,
        riskLevel: checkpoint.risk_level,
      });
      continue;
    }

    // Execute step
    await executeWorkflowStep(workflowId, step);
  }
}

// ---------------------------------------------------------------------------
// Execute a single workflow step
// ---------------------------------------------------------------------------

async function executeWorkflowStep(workflowId: string, step: any): Promise<void> {
  console.log(`[WorkflowEngine] Executing step ${step.id}: ${step.agent_id} — "${step.description.substring(0, 80)}"`);

  // Build context from completed dependency outputs
  const deps: string[] = step.depends_on ? JSON.parse(step.depends_on) : [];
  let depContext = '';
  if (deps.length > 0) {
    const depOutputs = deps
      .map(depId => db.prepare('SELECT agent_id, description, output FROM workflow_steps WHERE id = ?').get(depId) as any)
      .filter(d => d?.output);

    if (depOutputs.length > 0) {
      depContext = '\n\n--- Previous Step Results ---\n' +
        depOutputs.map(d => `[${d.agent_id}] ${d.description.substring(0, 100)}:\n${d.output.substring(0, 1000)}`).join('\n\n') +
        '\n--- End Previous Results ---\n';
    }
  }

  // Create a task for this step
  const fullDescription = depContext
    ? `${step.description}${depContext}`
    : step.description;

  const result = db.prepare(
    "INSERT INTO tasks (agent_id, description, status) VALUES (?, ?, 'in_progress')"
  ).run(step.agent_id, fullDescription);
  const taskId = Number(result.lastInsertRowid);

  // Link step to task
  db.prepare("UPDATE workflow_steps SET status = 'running', task_id = ?, started_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?")
    .run(taskId, step.id);

  publishEvent('groot:workflow', {
    type: 'workflow:step_started',
    workflowId,
    stepId: step.id,
    agentId: step.agent_id,
    taskId,
  });

  // Execute the task
  try {
    await executeTask(taskId, step.agent_id, fullDescription);
  } catch (err: any) {
    console.error(`[WorkflowEngine] Step ${step.id} execution failed:`, err.message);
    db.prepare("UPDATE workflow_steps SET status = 'failed', error = ? WHERE id = ?")
      .run(err.message, step.id);
    // Continue advancing — other steps with condition='on_failure' may activate
    await advanceWorkflow(workflowId);
  }
}

// ---------------------------------------------------------------------------
// Called when a task completes — check if it belongs to a workflow step
// ---------------------------------------------------------------------------

export async function onWorkflowTaskCompleted(taskId: number, output?: string): Promise<void> {
  const step = db.prepare(
    "SELECT * FROM workflow_steps WHERE task_id = ? AND status = 'running'"
  ).get(taskId) as any;

  if (!step) return; // not a workflow task

  const status = output ? 'completed' : 'failed';
  db.prepare(`
    UPDATE workflow_steps
    SET status = ?, output = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE id = ?
  `).run(status, output || '', step.id);

  console.log(`[WorkflowEngine] Step ${step.id} ${status} (task #${taskId})`);

  publishEvent('groot:workflow', {
    type: 'workflow:step_completed',
    workflowId: step.workflow_id,
    stepId: step.id,
    status,
  });

  // Advance the workflow
  await advanceWorkflow(step.workflow_id);
}

// ---------------------------------------------------------------------------
// Checkpoint approval
// ---------------------------------------------------------------------------

export async function approveCheckpoint(
  checkpointId: string,
  respondedBy: string = 'das'
): Promise<{ approved: boolean; error?: string }> {
  const checkpoint = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
  if (!checkpoint) return { approved: false, error: 'Checkpoint not found' };
  if (checkpoint.status !== 'pending') return { approved: false, error: `Checkpoint already ${checkpoint.status}` };

  db.prepare(`
    UPDATE checkpoints
    SET status = 'approved', responded_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), responded_by = ?
    WHERE id = ?
  `).run(respondedBy, checkpointId);

  db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)')
    .run('groot', 'checkpoint_approved', `${checkpointId}: ${checkpoint.description}`);

  console.log(`[WorkflowEngine] Checkpoint ${checkpointId} approved by ${respondedBy}`);

  // Advance the workflow now that checkpoint is cleared
  if (checkpoint.workflow_id) {
    await advanceWorkflow(checkpoint.workflow_id);
  }

  return { approved: true };
}

export async function rejectCheckpoint(
  checkpointId: string,
  respondedBy: string = 'das'
): Promise<{ rejected: boolean; error?: string }> {
  const checkpoint = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
  if (!checkpoint) return { rejected: false, error: 'Checkpoint not found' };

  db.prepare(`
    UPDATE checkpoints
    SET status = 'rejected', responded_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), responded_by = ?
    WHERE id = ?
  `).run(respondedBy, checkpointId);

  // Skip the step and any downstream
  if (checkpoint.step_id) {
    db.prepare("UPDATE workflow_steps SET status = 'skipped' WHERE id = ?").run(checkpoint.step_id);
  }

  if (checkpoint.workflow_id) {
    await advanceWorkflow(checkpoint.workflow_id);
  }

  return { rejected: true };
}

// ---------------------------------------------------------------------------
// Get workflow status
// ---------------------------------------------------------------------------

export function getWorkflowStatus(workflowId: string): WorkflowStatus | null {
  const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
  if (!workflow) return null;

  const steps = db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_number')
    .all(workflowId) as any[];

  const total = steps.length;
  const completed = steps.filter(s => s.status === 'completed').length;
  const failed = steps.filter(s => s.status === 'failed').length;
  const running = steps.filter(s => s.status === 'running').length;
  const pending = steps.filter(s => ['pending', 'ready'].includes(s.status)).length;

  return {
    id: workflow.id,
    name: workflow.name,
    status: workflow.status,
    steps: steps.map(s => ({
      id: s.id,
      stepNumber: s.step_number,
      agentId: s.agent_id,
      description: s.description,
      dependsOn: s.depends_on ? JSON.parse(s.depends_on) : null,
      status: s.status,
      output: s.output,
      taskId: s.task_id,
    })),
    progress: { total, completed, failed, running, pending },
  };
}

// ---------------------------------------------------------------------------
// List workflows
// ---------------------------------------------------------------------------

export function listWorkflows(status?: string, limit: number = 20): any[] {
  let sql = 'SELECT * FROM workflows';
  const params: any[] = [];
  if (status) { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

// ---------------------------------------------------------------------------
// Cancel a workflow
// ---------------------------------------------------------------------------

export function cancelWorkflow(workflowId: string): boolean {
  const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
  if (!workflow) return false;

  // Kill any running steps and their tasks/sessions
  const runningSteps = db.prepare(
    "SELECT * FROM workflow_steps WHERE workflow_id = ? AND status = 'running'"
  ).all(workflowId) as any[];

  for (const step of runningSteps) {
    if (step.task_id) _killSessionFn?.(Number(step.task_id));
    db.prepare("UPDATE workflow_steps SET status = 'cancelled' WHERE id = ?").run(step.id);
  }

  // Skip remaining pending/ready steps
  db.prepare("UPDATE workflow_steps SET status = 'skipped' WHERE workflow_id = ? AND status IN ('pending', 'ready')")
    .run(workflowId);

  db.prepare("UPDATE workflows SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?")
    .run(workflowId);

  publishEvent('groot:workflow', { type: 'workflow:cancelled', workflowId });
  return true;
}

// ---------------------------------------------------------------------------
// Delete a workflow (hard delete)
// ---------------------------------------------------------------------------

export function deleteWorkflow(workflowId: string): boolean {
  const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
  if (!workflow) return false;

  // Kill running tasks first (no-op if already cancelled/completed)
  cancelWorkflow(workflowId);

  db.transaction(() => {
    db.prepare('DELETE FROM checkpoints WHERE workflow_id = ?').run(workflowId);
    db.prepare('DELETE FROM workflow_steps WHERE workflow_id = ?').run(workflowId);
    db.prepare('DELETE FROM workflows WHERE id = ?').run(workflowId);
  })();

  publishEvent('groot:workflow', { type: 'workflow:deleted', workflowId });
  console.log(`[WorkflowEngine] Deleted workflow ${workflowId}`);
  return true;
}

// ---------------------------------------------------------------------------
// Create workflow from pipeline suggestion (bridges Quick Win to Longer-Term)
// ---------------------------------------------------------------------------

export function createWorkflowFromPipeline(
  pipeline: Array<{ step: number; agent: string; task: string }>,
  name: string
): string {
  const prefix = `${Date.now()}`;
  const steps: WorkflowStep[] = pipeline.map((p, i) => ({
    id: `${prefix}-step-${i + 1}`,
    agentId: p.agent,
    description: p.task,
    dependsOn: i > 0 ? [`${prefix}-step-${i}`] : [],
    condition: 'on_success',
  }));

  return createWorkflow({ name, steps });
}
