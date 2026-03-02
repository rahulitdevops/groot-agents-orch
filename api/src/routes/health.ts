import { FastifyInstance } from 'fastify';
import db from '../db.js';

const startTime = Date.now();

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    let dbOk = false;
    try {
      db.prepare('SELECT 1').get();
      dbOk = true;
    } catch {}

    let redisOk = false;
    try {
      const { publisher } = await import('../redis.js');
      await publisher.ping();
      redisOk = true;
    } catch {}

    return {
      status: 'ok',
      db: dbOk,
      redis: redisOk,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
  });
}
