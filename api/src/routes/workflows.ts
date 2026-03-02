import { FastifyInstance } from 'fastify';
import {
  createWorkflow,
  createWorkflowFromPipeline,
  startWorkflow,
  getWorkflowStatus,
  listWorkflows,
  cancelWorkflow,
  deleteWorkflow,
  approveCheckpoint,
  rejectCheckpoint,
} from '../workflow-engine.js';
import { suggestPipeline } from '../task-engine.js';
import db from '../db.js';

export default async function workflowRoutes(app: FastifyInstance) {

  // ─── List workflows ───
  app.get<{ Querystring: { status?: string; limit?: string } }>(
    '/api/workflows',
    async (req) => {
      return listWorkflows(req.query.status, parseInt(req.query.limit || '20'));
    }
  );

  // ─── Get workflow details ───
  app.get<{ Params: { id: string } }>('/api/workflows/:id', async (req, reply) => {
    const status = getWorkflowStatus(req.params.id);
    if (!status) return reply.status(404).send({ error: 'Workflow not found' });
    return status;
  });

  // ─── Create workflow from explicit plan ───
  app.post('/api/workflows', async (req, reply) => {
    const { name, description, steps, sequential } = req.body as any;
    if (!name || !steps || !Array.isArray(steps) || steps.length === 0) {
      return reply.status(400).send({ error: 'name and steps[] required' });
    }

    // Auto-wire sequential dependencies: each step depends on the previous.
    // Default: sequential=true. Pass sequential=false for parallel execution.
    const shouldChain = sequential !== false;
    if (shouldChain) {
      const sorted = [...steps].sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
      for (let i = 0; i < sorted.length; i++) {
        if (!sorted[i].id) sorted[i].id = `step-${i + 1}`;
      }
      for (let i = 1; i < sorted.length; i++) {
        if (!sorted[i].dependsOn) {
          sorted[i].dependsOn = [sorted[i - 1].id];
        }
      }
      steps.splice(0, steps.length, ...sorted);
    }

    const id = createWorkflow({ name, description, steps });
    return reply.status(201).send({ id, ...getWorkflowStatus(id) });
  });

  // ─── Create workflow from a task description (auto-pipeline) ───
  app.post('/api/workflows/from-task', async (req, reply) => {
    const { description, autoStart } = req.body as { description: string; autoStart?: boolean };
    if (!description) return reply.status(400).send({ error: 'description required' });

    const pipeline = suggestPipeline(description);
    const steps = pipeline.length > 1 ? pipeline : [
      { step: 1, agent: pipeline[0]?.agent || 'builder', task: description },
      { step: 2, agent: 'qa', task: `Test and verify: ${description}` },
    ];

    const name = `Auto: ${description.substring(0, 80)}`;
    const id = createWorkflowFromPipeline(steps, name);

    if (autoStart) {
      await startWorkflow(id);
    }

    return reply.status(201).send({ id, ...getWorkflowStatus(id) });
  });

  // ─── Start a workflow ───
  app.post<{ Params: { id: string } }>('/api/workflows/:id/start', async (req, reply) => {
    const result = await startWorkflow(req.params.id);
    if (!result.started) return reply.status(400).send({ error: result.error });
    return { ok: true, ...getWorkflowStatus(req.params.id) };
  });

  // ─── Cancel a workflow ───
  app.post<{ Params: { id: string } }>('/api/workflows/:id/cancel', async (req, reply) => {
    const success = cancelWorkflow(req.params.id);
    if (!success) return reply.status(404).send({ error: 'Workflow not found' });
    return { ok: true };
  });

  // ─── Delete a workflow ───
  app.delete<{ Params: { id: string } }>('/api/workflows/:id', async (req, reply) => {
    const success = deleteWorkflow(req.params.id);
    if (!success) return reply.status(400).send({ error: 'Workflow not found or still running (cancel first)' });
    return { ok: true };
  });

  // ─── Checkpoints ───

  app.get('/api/checkpoints', async (req) => {
    const { status } = req.query as { status?: string };
    let sql = 'SELECT c.*, ws.description as step_description, w.name as workflow_name FROM checkpoints c LEFT JOIN workflow_steps ws ON c.step_id = ws.id LEFT JOIN workflows w ON c.workflow_id = w.id';
    const params: any[] = [];
    if (status) { sql += ' WHERE c.status = ?'; params.push(status); }
    sql += ' ORDER BY c.requested_at DESC LIMIT 50';
    return db.prepare(sql).all(...params);
  });

  app.post<{ Params: { id: string } }>('/api/checkpoints/:id/approve', async (req, reply) => {
    const { respondedBy } = (req.body || {}) as { respondedBy?: string };
    const result = await approveCheckpoint(req.params.id, respondedBy || 'das');
    if (!result.approved) return reply.status(400).send({ error: result.error });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/checkpoints/:id/reject', async (req, reply) => {
    const { respondedBy } = (req.body || {}) as { respondedBy?: string };
    const result = await rejectCheckpoint(req.params.id, respondedBy || 'das');
    if (!result.rejected) return reply.status(400).send({ error: result.error });
    return { ok: true };
  });
}
