import { FastifyInstance } from 'fastify';
import {
  writeMemory,
  readMemory,
  listMemory,
  searchMemory,
  listNamespaces,
  deleteMemory,
  deleteNamespace,
  getMemoryContextForTask,
} from '../shared-memory.js';

export default async function memoryRoutes(app: FastifyInstance) {

  // ─── List all namespaces ───
  app.get('/api/memory', async () => {
    return listNamespaces();
  });

  // ─── List entries in a namespace ───
  app.get<{ Params: { namespace: string } }>('/api/memory/:namespace', async (req) => {
    return listMemory(req.params.namespace);
  });

  // ─── Read a specific key ───
  app.get<{ Params: { namespace: string; key: string } }>(
    '/api/memory/:namespace/:key',
    async (req, reply) => {
      const entry = readMemory(req.params.namespace, req.params.key);
      if (!entry) return reply.status(404).send({ error: 'Key not found' });
      return entry;
    }
  );

  // ─── Write / update a key ───
  app.put<{ Params: { namespace: string; key: string } }>(
    '/api/memory/:namespace/:key',
    async (req, reply) => {
      const { value, writtenBy, taskId, ttlHours } = req.body as {
        value: string; writtenBy?: string; taskId?: number; ttlHours?: number;
      };
      if (!value) return reply.status(400).send({ error: 'value required' });
      writeMemory(req.params.namespace, req.params.key, value, writtenBy || 'api', { taskId, ttlHours });
      return { ok: true, ...readMemory(req.params.namespace, req.params.key) };
    }
  );

  // ─── Delete a key ───
  app.delete<{ Params: { namespace: string; key: string } }>(
    '/api/memory/:namespace/:key',
    async (req, reply) => {
      const deleted = deleteMemory(req.params.namespace, req.params.key);
      if (!deleted) return reply.status(404).send({ error: 'Key not found' });
      return { ok: true };
    }
  );

  // ─── Delete entire namespace ───
  app.delete<{ Params: { namespace: string } }>(
    '/api/memory/:namespace',
    async (req) => {
      const count = deleteNamespace(req.params.namespace);
      return { ok: true, deleted: count };
    }
  );

  // ─── Search across memory ───
  app.get<{ Querystring: { q: string; namespace?: string; writtenBy?: string; limit?: string } }>(
    '/api/memory-search',
    async (req, reply) => {
      const { q, namespace, writtenBy, limit } = req.query;
      if (!q) return reply.status(400).send({ error: 'q (query) required' });
      return searchMemory(q, { namespace, writtenBy, limit: limit ? parseInt(limit) : undefined });
    }
  );

  // ─── Get context injection preview (for debugging) ───
  app.post('/api/memory/context-preview', async (req, reply) => {
    const { agentId, description } = req.body as { agentId: string; description: string };
    if (!agentId || !description) return reply.status(400).send({ error: 'agentId and description required' });
    return { context: getMemoryContextForTask(agentId, description) };
  });
}
