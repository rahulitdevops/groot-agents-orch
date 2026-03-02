import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db from '../db.js';

const MetricBody = z.object({
  type: z.string(),
  value: z.number(),
});

export default async function metricsRoutes(app: FastifyInstance) {
  app.post('/api/metrics', async (req, reply) => {
    const body = MetricBody.parse(req.body);
    const result = db.prepare('INSERT INTO metrics (type, value) VALUES (?, ?)').run(body.type, body.value);
    return reply.status(201).send(db.prepare('SELECT * FROM metrics WHERE id = ?').get(result.lastInsertRowid));
  });

  app.get<{ Querystring: { type?: string; since?: string; limit?: string } }>(
    '/api/metrics',
    async (req) => {
      let sql = 'SELECT * FROM metrics WHERE 1=1';
      const params: any[] = [];
      if (req.query.type) { sql += ' AND type = ?'; params.push(req.query.type); }
      if (req.query.since) { sql += ' AND timestamp >= ?'; params.push(req.query.since); }
      sql += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(parseInt(req.query.limit || '100'));
      return db.prepare(sql).all(...params);
    }
  );
}
