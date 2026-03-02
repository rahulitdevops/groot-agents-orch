import { FastifyInstance } from 'fastify';
import {
  getAgentStats,
  getPerformanceSummary,
  getRoutingBoost,
  recordPerformance,
} from '../agent-performance.js';

export default async function performanceRoutes(app: FastifyInstance) {

  // ─── Overall performance summary (dashboard) ───
  app.get('/api/performance', async () => {
    return getPerformanceSummary();
  });

  // ─── Agent-specific stats ───
  app.get<{ Params: { agentId: string }; Querystring: { taskType?: string } }>(
    '/api/performance/:agentId',
    async (req) => {
      return getAgentStats(req.params.agentId, req.query.taskType);
    }
  );

  // ─── Routing boost preview (for debugging routing decisions) ───
  app.post('/api/performance/routing-boost', async (req, reply) => {
    const { agentId, description } = req.body as { agentId: string; description: string };
    if (!agentId || !description) return reply.status(400).send({ error: 'agentId and description required' });
    return { agentId, boost: getRoutingBoost(agentId, description) };
  });

  // ─── Manually record a performance entry (for testing / backfill) ───
  app.post('/api/performance', async (req, reply) => {
    const { agentId, taskId, description, evaluation, durationMs } = req.body as {
      agentId: string; taskId?: number; description: string; evaluation: string; durationMs?: number;
    };
    if (!agentId || !description || !evaluation) {
      return reply.status(400).send({ error: 'agentId, description, evaluation required' });
    }
    if (!['success', 'partial', 'failed'].includes(evaluation)) {
      return reply.status(400).send({ error: 'evaluation must be success|partial|failed' });
    }
    recordPerformance(agentId, taskId || 0, description, evaluation as any, durationMs);
    return { ok: true };
  });
}
