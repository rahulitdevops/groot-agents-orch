import { FastifyInstance } from 'fastify';
import { subscriber, isRedisConnected } from '../redis.js';

export default async function eventsRoutes(app: FastifyInstance) {
  app.get('/api/events', async (req, reply) => {
    if (!isRedisConnected()) {
      return reply.status(503).send({ error: 'Redis not available' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const channels = ['groot:agent', 'groot:task', 'groot:sre', 'agent:status', 'task:update', 'sre:check', 'groot:workflow', 'groot:checkpoint'];

    // Send initial heartbeat so browser knows SSE is connected
    reply.raw.write(`event: heartbeat\ndata: {"ts":"${new Date().toISOString()}"}\n\n`);

    const handler = (channel: string, message: string) => {
      reply.raw.write(`event: ${channel}\ndata: ${message}\n\n`);
    };

    for (const ch of channels) {
      subscriber.subscribe(ch);
    }
    subscriber.on('message', handler);

    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
      reply.raw.write(`event: heartbeat\ndata: {"ts":"${new Date().toISOString()}"}\n\n`);
    }, 30000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      subscriber.removeListener('message', handler);
      for (const ch of channels) {
        subscriber.unsubscribe(ch);
      }
    });
  });
}
