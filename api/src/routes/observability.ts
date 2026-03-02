import { FastifyInstance } from 'fastify';
import { generateSummary, generateTextSummary } from '../observability.js';

export default async function observabilityRoutes(app: FastifyInstance) {

  // ─── Structured summary (JSON) ───
  app.get<{ Querystring: { hours?: string } }>(
    '/api/observability/summary',
    async (req) => {
      const hours = parseInt(req.query.hours || '24');
      return generateSummary(hours);
    }
  );

  // ─── Text summary (for WhatsApp / notifications) ───
  app.get<{ Querystring: { hours?: string } }>(
    '/api/observability/text',
    async (req) => {
      const hours = parseInt(req.query.hours || '24');
      return { text: generateTextSummary(hours) };
    }
  );
}
