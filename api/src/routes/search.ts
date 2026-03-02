import { FastifyInstance } from 'fastify';
import db from '../db.js';
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(process.env.PROJECT_ROOT || path.join(import.meta.dirname, '../../../'));

function searchFiles(dir: string, query: string, base: string): { name: string; path: string; type: string }[] {
  const results: { name: string; path: string; type: string }[] = [];
  if (!fs.existsSync(dir)) return results;
  const q = query.toLowerCase();
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isFile()) {
        if (entry.name.toLowerCase().includes(q)) {
          results.push({ name: entry.name, path: path.relative(base, full), type: 'file' });
        }
      } else if (entry.isDirectory()) {
        walk(full);
      }
    }
  }
  walk(dir);
  return results;
}

export default async function searchRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string } }>('/api/search', async (req, reply) => {
    const q = req.query.q?.trim();
    if (!q) return reply.status(400).send({ error: 'Query parameter q is required' });

    const tasks = db.prepare(
      "SELECT id, agent_id, description, status, created_at FROM tasks WHERE description LIKE ? ORDER BY created_at DESC LIMIT 20"
    ).all(`%${q}%`) as any[];

    const researchFiles = searchFiles(path.join(PROJECT_ROOT, 'research'), q, path.join(PROJECT_ROOT, 'research'));
    const outputFiles = searchFiles(path.join(PROJECT_ROOT, 'output'), q, path.join(PROJECT_ROOT, 'output'));

    return {
      tasks: tasks.map(t => ({ id: t.id, agentId: t.agent_id, description: t.description, status: t.status, timestamp: t.created_at, type: 'task' })),
      files: [...researchFiles.map(f => ({ ...f, source: 'research' })), ...outputFiles.map(f => ({ ...f, source: 'output' }))],
    };
  });
}
