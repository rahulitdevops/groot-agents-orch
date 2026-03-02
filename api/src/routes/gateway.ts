import { FastifyInstance } from 'fastify';
import { openclawBridge } from '../openclaw-ws.js';

export default async function gatewayRoutes(app: FastifyInstance) {
  app.get('/api/gateway', async (_request, reply) => {
    try {
      const res = await fetch('http://127.0.0.1:18789', { signal: AbortSignal.timeout(3000) });
      return reply.send({ status: res.ok ? 'ok' : 'error' });
    } catch {
      return reply.send({ status: 'error' });
    }
  });

  app.get('/api/openclaw/status', async (_request, reply) => {
    return reply.send(openclawBridge.status);
  });

  app.post('/api/openclaw/sync', async (_request, reply) => {
    try {
      await openclawBridge.syncSessions();
      return reply.send({ ok: true, ...openclawBridge.status });
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });
}
