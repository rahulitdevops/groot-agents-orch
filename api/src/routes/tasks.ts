import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db from '../db.js';
import { autoAssign, processNewTask, suggestPipeline } from '../task-engine.js';

const VALID_STATUSES = ['todo', 'in_progress', 'done', 'scheduled', 'failed',
  'pending', 'running', 'working', 'completed'] as const;

const CreateTaskBody = z.object({
  agentId: z.string(),
  description: z.string(),
  status: z.enum(VALID_STATUSES).optional().default('todo'),
  runNow: z.boolean().optional().default(false),
});

const PatchTaskBody = z.object({
  status: z.enum(VALID_STATUSES).optional(),
  output: z.string().optional(),
});

export default async function taskRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { agentId?: string; status?: string; limit?: string; offset?: string } }>(
    '/api/tasks',
    async (req) => {
      let sql = 'SELECT * FROM tasks WHERE 1=1';
      const params: any[] = [];
      if (req.query.agentId) { sql += ' AND agent_id = ?'; params.push(req.query.agentId); }
      if (req.query.status) { sql += ' AND status = ?'; params.push(req.query.status); }
      sql += ' ORDER BY created_at DESC';
      sql += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(req.query.limit || '50'));
      params.push(parseInt(req.query.offset || '0'));
      return db.prepare(sql).all(...params);
    }
  );

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return task;
  });

  // Auto-assign preview endpoint (now uses smart routing)
  app.post('/api/tasks/auto-assign', async (req) => {
    const { description } = req.body as { description: string };
    return { agentId: autoAssign(description || '') };
  });

  // Pipeline suggestion — shows multi-step plan for complex tasks
  app.post('/api/tasks/suggest-pipeline', async (req) => {
    const { description } = req.body as { description: string };
    return { pipeline: suggestPipeline(description || '') };
  });

  app.post('/api/tasks', async (req, reply) => {
    const body = CreateTaskBody.parse(req.body);
    const resolvedAgent = (!body.agentId || body.agentId === 'auto') ? autoAssign(body.description) : body.agentId;

    const result = db.prepare(
      'INSERT INTO tasks (agent_id, description, status) VALUES (?, ?, ?)'
    ).run(resolvedAgent, body.description, body.status);

    const taskId = Number(result.lastInsertRowid);

    db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)').run(
      resolvedAgent, 'task_created', body.description
    );

    // If runNow is true, trigger the task engine
    let engineResult: any = null;
    if (body.runNow && (body.status === 'todo' || body.status === 'in_progress')) {
      engineResult = await processNewTask(taskId, resolvedAgent, body.description, true);
    }

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return reply.status(201).send({ ...task as any, _engine: engineResult });
  });

  app.patch<{ Params: { id: string }; Body: z.infer<typeof PatchTaskBody> }>(
    '/api/tasks/:id',
    async (req, reply) => {
      const body = PatchTaskBody.parse(req.body);
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
      if (!task) return reply.status(404).send({ error: 'Task not found' });

      const sets: string[] = [];
      const vals: any[] = [];
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
      }
      if (body.status === 'completed' || body.status === 'done') {
        sets.push("completed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')");
      }
      if (sets.length === 0) return task;

      vals.push(req.params.id);
      db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

      if (body.status) {
        db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)').run(
          task.agent_id, 'task_' + body.status, `Task #${req.params.id}`
        );
      }

      return db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    }
  );

  // Task notification endpoint
  app.get<{ Params: { id: string } }>('/api/tasks/:id/notify', async (req, reply) => {
    const task = db.prepare('SELECT t.*, a.name as agent_name, a.emoji as agent_emoji FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id WHERE t.id = ?').get(req.params.id) as any;
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return {
      title: `${task.agent_emoji || '🤖'} ${task.agent_name || task.agent_id} — Task #${task.id}`,
      body: task.description?.substring(0, 100),
      status: task.status,
      output: task.output?.substring(0, 500),
    };
  });
}
