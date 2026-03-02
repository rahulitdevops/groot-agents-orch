import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { connectRedis } from './redis.js';
import agentRoutes from './routes/agents.js';
import taskRoutes from './routes/tasks.js';
import sreRoutes from './routes/sre.js';
import metricsRoutes from './routes/metrics.js';
import activityRoutes from './routes/activity.js';
import webhookRoutes from './routes/webhook.js';
import healthRoutes from './routes/health.js';
import eventsRoutes from './routes/events.js';
import systemRoutes from "./routes/system.js";
import usageRoutes from "./routes/usage.js";
import gatewayRoutes from "./routes/gateway.js";
import filesRoutes from "./routes/files.js";
import searchRoutes from "./routes/search.js";
import workflowRoutes from "./routes/workflows.js";
import memoryRoutes from "./routes/memory.js";
import performanceRoutes from "./routes/performance.js";
import observabilityRoutes from "./routes/observability.js";
import configRoutes from "./routes/config.js";
import { openclawBridge } from "./openclaw-ws.js";
import { setBridge } from "./task-engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.API_PORT || '3333');
const DASHBOARD_DIR = join(__dirname, '../../dashboard/out');
const AUTH_TOKEN = process.env.GROOT_DASHBOARD_TOKEN || '';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// Auth hook — skip /api/health and static files
if (AUTH_TOKEN) {
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/health')) return;
    if (!req.url.startsWith('/api/')) return;

    const authHeader = req.headers.authorization;
    const queryToken = (req.query as any)?.token;
    const token = authHeader?.replace(/^Bearer\s+/i, '') || queryToken;

    if (token !== AUTH_TOKEN) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });
}

// Register API routes
await app.register(agentRoutes);
await app.register(taskRoutes);
await app.register(sreRoutes);
await app.register(metricsRoutes);
await app.register(activityRoutes);
await app.register(webhookRoutes);
await app.register(healthRoutes);
await app.register(eventsRoutes);
await app.register(systemRoutes);
await app.register(usageRoutes);
await app.register(gatewayRoutes);
await app.register(filesRoutes);
await app.register(searchRoutes);
await app.register(workflowRoutes);
await app.register(memoryRoutes);
await app.register(performanceRoutes);
await app.register(observabilityRoutes);
await app.register(configRoutes);

// Serve Next.js static export
await app.register(fastifyStatic, {
  root: DASHBOARD_DIR,
  prefix: '/',
  wildcard: true,
});

// SPA fallback - serve index.html for client-side routes only
app.setNotFoundHandler(async (request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.status(404).send({ error: 'Not found' });
  }
  // Don't serve index.html for static asset paths — let them 404 cleanly
  if (request.url.startsWith('/_next/') || request.url.match(/\.(js|css|ico|png|svg|woff2?|json|txt)$/)) {
    return reply.status(404).send({ error: 'Not found' });
  }
  return reply.sendFile('index.html');
});

// Connect Redis (non-blocking, SSE degrades gracefully)
await connectRedis();

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Groot API + Dashboard running on http://0.0.0.0:${PORT}`);

  // Start OpenClaw Gateway bridge
  openclawBridge.start();
  setBridge(openclawBridge);

  // Graceful shutdown
  const shutdown = () => { openclawBridge.stop(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
