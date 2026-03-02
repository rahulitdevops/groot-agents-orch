import { FastifyInstance } from 'fastify';
import db from '../db.js';

export default async function activityRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { agentId?: string; limit?: string } }>(
    '/api/activity',
    async (req) => {
      let sql = 'SELECT * FROM activity_log WHERE 1=1';
      const params: any[] = [];
      if (req.query.agentId) { sql += ' AND agent_id = ?'; params.push(req.query.agentId); }
      sql += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(parseInt(req.query.limit || '50'));
      return db.prepare(sql).all(...params);
    }
  );
}
