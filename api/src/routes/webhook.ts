import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db from '../db.js';

const WEBHOOK_SECRET = process.env.GROOT_WEBHOOK_SECRET || 'change-me-to-random-string';

const WebhookBody = z.object({
  event: z.string().refine(
    (v): v is 'agent.status' | 'task.start' | 'task.done' | 'task.fail' | 'sre.check' =>
      ['agent.status', 'task.start', 'task.done', 'task.fail', 'sre.check'].includes(v),
    { message: 'Invalid event type' }
  ),
  data: z.object({}).passthrough(),
});

export default async function webhookRoutes(app: FastifyInstance) {
  app.post('/api/webhook', async (req, reply) => {
    const secret = req.headers['x-groot-secret'];
    if (secret !== WEBHOOK_SECRET) {
      return reply.status(401).send({ error: 'Invalid secret' });
    }

    const body = WebhookBody.parse(req.body);
    const event = body.event as string;
    const data = body.data as Record<string, any>;

    switch (event) {
      case 'agent.status': {
        const { agentId, status, lastTask } = data;
        db.prepare(
          `UPDATE agents SET status = ?, last_task = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
        ).run(status, lastTask || null, agentId);
        db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)').run(
          agentId, 'webhook:agent.status', JSON.stringify(data)
        );
        break;
      }
      case 'task.start': {
        const { agentId, description } = data;
        const result = db.prepare('INSERT INTO tasks (agent_id, description, status) VALUES (?, ?, ?)').run(
          agentId, description, 'running'
        );
        db.prepare(
          `UPDATE agents SET status = 'working', last_task = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
        ).run(description, agentId);
        db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)').run(
          agentId, 'webhook:task.start', description
        );
        return reply.status(200).send({ taskId: Number(result.lastInsertRowid) });
      }
      case 'task.done': {
        const { taskId, output } = data;
        db.prepare(
          `UPDATE tasks SET status = 'completed', output = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
        ).run(output || null, taskId);
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
        if (task) {
          db.prepare(
            `UPDATE agents SET status = 'idle', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
          ).run(task.agent_id);
        }
        db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)').run(
          task?.agent_id || null, 'webhook:task.done', `Task #${taskId}`
        );
        break;
      }
      case 'task.fail': {
        const { taskId, output } = data;
        db.prepare(
          `UPDATE tasks SET status = 'failed', output = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
        ).run(output || null, taskId);
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
        if (task) {
          db.prepare(
            `UPDATE agents SET status = 'error', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
          ).run(task.agent_id);
        }
        db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)').run(
          task?.agent_id || null, 'webhook:task.fail', `Task #${taskId}`
        );
        break;
      }
      case 'sre.check': {
        db.prepare(
          `INSERT INTO sre_checks (dashboard_status, gateway_status, cpu, memory, disk, details)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(data.dashboardStatus ?? null, data.gatewayStatus ?? null,
          data.cpu ?? null, data.memory ?? null, data.disk ?? null, data.details ?? null);
        db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)').run(
          'sre', 'webhook:sre.check', JSON.stringify(data)
        );
        break;
      }
    }

    return { ok: true };
  });
}
