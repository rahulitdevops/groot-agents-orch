import { FastifyInstance } from 'fastify';
import db from '../db.js';

const APP_VERSION = '2.1.0';
const API_PORT = parseInt(process.env.API_PORT || '3333');
const GATEWAY_PORT = parseInt(process.env.OPENCLAW_GATEWAY_PORT || '18789');

const PLAN = {
  name: process.env.PLAN_NAME || 'Claude Max',
  price: parseInt(process.env.PLAN_PRICE || '100'),
  provider: process.env.PLAN_PROVIDER || 'Anthropic',
};

const MONTHLY_LIMIT = PLAN.price; // budget matches plan price
const DAILY_LIMIT = parseInt(process.env.DAILY_BUDGET || '10');

const AVAILABLE_MODELS = [
  { value: 'opus', label: 'Claude Opus 4', tier: 'heavy' },
  { value: 'sonnet', label: 'Claude Sonnet 4', tier: 'medium' },
  { value: 'haiku', label: 'Claude Haiku 3', tier: 'light' },
];

export default async function configRoutes(app: FastifyInstance) {
  app.get('/api/config', async () => {
    // Get cron jobs from DB if table exists
    let cronJobs: any[] = [];
    try {
      cronJobs = db.prepare(
        "SELECT id, name, schedule, enabled, last_run FROM cron_jobs ORDER BY name"
      ).all() as any[];
    } catch {
      // cron_jobs table may not exist
    }

    // Get agent count and active count
    let agentStats = { total: 0, active: 0 };
    try {
      const stats = db.prepare(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status IN ('running','working') THEN 1 ELSE 0 END) as active FROM agents"
      ).get() as any;
      agentStats = { total: stats?.total || 0, active: stats?.active || 0 };
    } catch {}

    return {
      version: APP_VERSION,
      apiPort: API_PORT,
      gatewayPort: GATEWAY_PORT,
      plan: PLAN,
      monthlyLimit: MONTHLY_LIMIT,
      dailyLimit: DAILY_LIMIT,
      models: AVAILABLE_MODELS,
      cronJobs,
      agentStats,
    };
  });
}
