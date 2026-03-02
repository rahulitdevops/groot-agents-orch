import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import db from '../db.js';

const AGENTS_DIR = join(homedir(), 'projects', 'groot', 'agents');

const PatchAgentBody = z.object({
  status: z.string().optional(),
  model: z.string().optional(),
  tier: z.string().optional(),
  last_task: z.string().optional(),
});

function getLevelForXp(xp: number): string {
  if (xp >= 1500) return 'expert';
  if (xp >= 500) return 'advanced';
  if (xp >= 100) return 'intermediate';
  return 'beginner';
}

export default async function agentRoutes(app: FastifyInstance) {
  app.get('/api/agents', async () => {
    return db.prepare('SELECT * FROM agents').all();
  });

  app.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return agent;
  });

  app.patch<{ Params: { id: string }; Body: z.infer<typeof PatchAgentBody> }>(
    '/api/agents/:id',
    async (req, reply) => {
      const body = PatchAgentBody.parse(req.body);
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
      if (!agent) return reply.status(404).send({ error: 'Agent not found' });

      const sets: string[] = [];
      const vals: any[] = [];
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
      }
      if (sets.length === 0) return agent;

      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')");
      vals.push(req.params.id);
      db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

      db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)').run(
        req.params.id, 'status_change', JSON.stringify(body)
      );

      return db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    }
  );

  // ─── Instructions Routes ───

  app.get<{ Params: { id: string } }>('/api/agents/:id/instructions', async (req, reply) => {
    const id = req.params.id;
    if (id === 'groot') {
      // Groot now has a proper CLAUDE.md like all other agents
      const grootPath = join(AGENTS_DIR, 'groot', 'CLAUDE.md');
      try {
        const content = await readFile(grootPath, 'utf-8');
        return { content, note: 'Groot supervisor prompt — editable via dashboard or directly in agents/groot/CLAUDE.md' };
      } catch {
        return { content: '', note: 'Groot CLAUDE.md not found — create agents/groot/CLAUDE.md' };
      }
    }
    const filePath = join(AGENTS_DIR, id, 'CLAUDE.md');
    try {
      const content = await readFile(filePath, 'utf-8');
      return { content };
    } catch {
      return { content: '' };
    }
  });

  app.put<{ Params: { id: string }; Body: { content: string } }>(
    '/api/agents/:id/instructions',
    async (req, reply) => {
      const id = req.params.id;
      // Groot instructions are now editable like any other agent
      const { content } = req.body || {};
      if (typeof content !== 'string') {
        return reply.status(400).send({ error: 'content string required' });
      }
      const dir = join(AGENTS_DIR, id);
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, 'CLAUDE.md');
      await writeFile(filePath, content, 'utf-8');
      return { ok: true };
    }
  );

  // ─── Skills Routes ───

  app.get<{ Params: { id: string } }>('/api/agents/:id/skills', async (req) => {
    return db.prepare('SELECT * FROM agent_skills WHERE agent_id = ? ORDER BY xp DESC').all(req.params.id);
  });

  app.post<{ Params: { id: string }; Body: { skill: string; level?: string; xp?: number } }>(
    '/api/agents/:id/skills',
    async (req, reply) => {
      const { skill, level = 'beginner', xp = 0 } = req.body || {};
      if (!skill) return reply.status(400).send({ error: 'skill required' });
      try {
        const result = db.prepare(
          "INSERT INTO agent_skills (agent_id, skill, level, xp) VALUES (?, ?, ?, ?)"
        ).run(req.params.id, skill, level, xp);
        db.prepare(
          "INSERT INTO agent_skill_log (agent_id, skill, action, new_level) VALUES (?, ?, 'acquired', ?)"
        ).run(req.params.id, skill, level);
        return db.prepare('SELECT * FROM agent_skills WHERE id = ?').get(result.lastInsertRowid);
      } catch (e: any) {
        if (e.message?.includes('UNIQUE')) return reply.status(409).send({ error: 'Skill already exists' });
        throw e;
      }
    }
  );

  app.patch<{ Params: { id: string; skillId: string }; Body: { level?: string; xp?: number; times_used?: number } }>(
    '/api/agents/:id/skills/:skillId',
    async (req, reply) => {
      const skill = db.prepare('SELECT * FROM agent_skills WHERE id = ? AND agent_id = ?').get(
        req.params.skillId, req.params.id
      ) as any;
      if (!skill) return reply.status(404).send({ error: 'Skill not found' });

      const { level, xp, times_used } = req.body || {};
      const sets: string[] = [];
      const vals: any[] = [];
      if (level !== undefined) { sets.push('level = ?'); vals.push(level); }
      if (xp !== undefined) { sets.push('xp = ?'); vals.push(xp); }
      if (times_used !== undefined) { sets.push('times_used = ?'); vals.push(times_used); }
      if (sets.length === 0) return skill;

      vals.push(req.params.skillId);
      db.prepare(`UPDATE agent_skills SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return db.prepare('SELECT * FROM agent_skills WHERE id = ?').get(req.params.skillId);
    }
  );

  app.delete<{ Params: { id: string; skillId: string } }>(
    '/api/agents/:id/skills/:skillId',
    async (req, reply) => {
      const result = db.prepare('DELETE FROM agent_skills WHERE id = ? AND agent_id = ?').run(
        req.params.skillId, req.params.id
      );
      if (result.changes === 0) return reply.status(404).send({ error: 'Skill not found' });
      return { ok: true };
    }
  );

  app.get<{ Params: { id: string } }>('/api/agents/:id/skill-log', async (req) => {
    return db.prepare(
      'SELECT * FROM agent_skill_log WHERE agent_id = ? ORDER BY logged_at DESC LIMIT 20'
    ).all(req.params.id);
  });

  app.post<{ Params: { id: string; skillId: string }; Body: { xp?: number; task_id?: number } }>(
    '/api/agents/:id/skills/:skillId/use',
    async (req, reply) => {
      const skill = db.prepare('SELECT * FROM agent_skills WHERE id = ? AND agent_id = ?').get(
        req.params.skillId, req.params.id
      ) as any;
      if (!skill) return reply.status(404).send({ error: 'Skill not found' });

      const xpGain = req.body?.xp ?? Math.floor(Math.random() * 41) + 10; // 10-50
      const newXp = skill.xp + xpGain;
      const oldLevel = skill.level;
      const newLevel = getLevelForXp(newXp);

      db.prepare(
        "UPDATE agent_skills SET xp = ?, level = ?, times_used = times_used + 1, last_used = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
      ).run(newXp, newLevel, req.params.skillId);

      db.prepare(
        "INSERT INTO agent_skill_log (agent_id, skill, action, old_level, new_level, xp_gained, task_id) VALUES (?, ?, 'used', ?, ?, ?, ?)"
      ).run(req.params.id, skill.skill, oldLevel, newLevel, xpGain, req.body?.task_id ?? null);

      if (newLevel !== oldLevel) {
        db.prepare(
          "INSERT INTO agent_skill_log (agent_id, skill, action, old_level, new_level) VALUES (?, ?, 'leveled_up', ?, ?)"
        ).run(req.params.id, skill.skill, oldLevel, newLevel);
      }

      return db.prepare('SELECT * FROM agent_skills WHERE id = ?').get(req.params.skillId);
    }
  );

  app.get('/api/skills/summary', async () => {
    const totalUnique = (db.prepare("SELECT COUNT(DISTINCT skill) as c FROM agent_skills").get() as any)?.c ?? 0;
    const topSkills = db.prepare(
      "SELECT skill, SUM(times_used) as total_uses, COUNT(DISTINCT agent_id) as agent_count FROM agent_skills GROUP BY skill ORDER BY total_uses DESC LIMIT 5"
    ).all();
    const recentLevelUps = db.prepare(
      "SELECT * FROM agent_skill_log WHERE action = 'leveled_up' ORDER BY logged_at DESC LIMIT 5"
    ).all();
    return { totalUnique, topSkills, recentLevelUps };
  });

  // ─── Usage Routes ───

  app.get<{ Params: { id: string }; Querystring: { limit?: string; from?: string; to?: string } }>(
    '/api/agents/:id/usage',
    async (req) => {
      let sql = 'SELECT u.*, t.description as task_description FROM agent_usage u LEFT JOIN tasks t ON u.task_id = t.id WHERE u.agent_id = ?';
      const params: any[] = [req.params.id];
      if (req.query.from) { sql += ' AND u.recorded_at >= ?'; params.push(req.query.from); }
      if (req.query.to) { sql += ' AND u.recorded_at <= ?'; params.push(req.query.to); }
      sql += ' ORDER BY u.recorded_at DESC LIMIT ?';
      params.push(parseInt(req.query.limit || '50'));
      return db.prepare(sql).all(...params);
    }
  );

  app.get<{ Params: { id: string } }>('/api/agents/:id/usage/summary', async (req) => {
    const agentId = req.params.id;
    const totals = db.prepare(
      'SELECT SUM(total_tokens) as totalTokens, SUM(cost_usd) as totalCost, COUNT(*) as taskCount FROM agent_usage WHERE agent_id = ?'
    ).get(agentId) as any;

    const byModel = db.prepare(
      'SELECT model, SUM(total_tokens) as tokens, SUM(cost_usd) as cost FROM agent_usage WHERE agent_id = ? GROUP BY model'
    ).all(agentId) as any[];

    const daily = db.prepare(
      `SELECT date(recorded_at) as date, SUM(total_tokens) as tokens, SUM(cost_usd) as cost
       FROM agent_usage WHERE agent_id = ? AND recorded_at >= date('now', '-30 days')
       GROUP BY date(recorded_at) ORDER BY date DESC`
    ).all(agentId) as any[];

    const totalTokens = totals?.totalTokens || 0;
    const totalCost = totals?.totalCost || 0;
    const taskCount = totals?.taskCount || 0;

    return {
      totalTokens,
      totalCost,
      taskCount,
      avgTokensPerTask: taskCount > 0 ? Math.round(totalTokens / taskCount) : 0,
      avgCostPerTask: taskCount > 0 ? totalCost / taskCount : 0,
      byModel: Object.fromEntries(byModel.map(m => [m.model, { tokens: m.tokens, cost: m.cost }])),
      daily,
    };
  });

}
