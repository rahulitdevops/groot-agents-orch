import { FastifyInstance } from 'fastify';
import db from '../db.js';

const PLAN_PRICE = parseInt(process.env.PLAN_PRICE || '100');
const PLAN_NAME = process.env.PLAN_NAME || 'Claude Max';
const PLAN_PROVIDER = process.env.PLAN_PROVIDER || 'Anthropic';

interface ModelUsage {
  name: string;
  tokensIn: number;
  tokensOut: number;
  cacheHitRatio: number;
  cost: number;
}

export default async function usageRoutes(app: FastifyInstance) {
  app.get('/api/usage', async () => {
    try {
      const token = process.env.OPENCLAW_TOKEN || '';
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const res = await fetch('http://127.0.0.1:18789/api/usage', {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object') {
          return normalizeUsage(data);
        }
      }
    } catch {}
    
    return getFallbackUsage();
  });

  // Team-wide usage summary (includes byAgent, byModel, daily for dashboard)
  app.get('/api/usage/summary', async () => {
    try {
      const totals = db.prepare(
        'SELECT COALESCE(SUM(total_tokens),0) as totalTokens, COALESCE(SUM(cost_usd),0) as totalCost, COUNT(*) as taskCount FROM agent_usage'
      ).get() as any;

      const byAgent = db.prepare(
        `SELECT u.agent_id, a.name, a.emoji, SUM(u.total_tokens) as tokens, SUM(u.cost_usd) as cost, COUNT(*) as tasks
         FROM agent_usage u LEFT JOIN agents a ON u.agent_id = a.id GROUP BY u.agent_id ORDER BY cost DESC`
      ).all() as any[];

      const byModel = db.prepare(
        'SELECT model, SUM(total_tokens) as tokens, SUM(cost_usd) as cost FROM agent_usage GROUP BY model ORDER BY cost DESC'
      ).all() as any[];

      const daily = db.prepare(
        `SELECT date(recorded_at) as date, SUM(total_tokens) as tokens, SUM(cost_usd) as cost
         FROM agent_usage WHERE recorded_at >= date('now', '-30 days')
         GROUP BY date(recorded_at) ORDER BY date DESC`
      ).all() as any[];

      const todayTotals = db.prepare(
        `SELECT SUM(total_tokens) as tokens, SUM(cost_usd) as cost FROM agent_usage WHERE date(recorded_at) = date('now')`
      ).get() as any;

      const weekTotals = db.prepare(
        `SELECT SUM(cost_usd) as cost FROM agent_usage WHERE recorded_at >= date('now', '-7 days')`
      ).get() as any;

      const mostActiveToday = db.prepare(
        `SELECT u.agent_id, a.name, a.emoji, COUNT(*) as tasks, SUM(u.cost_usd) as cost
         FROM agent_usage u LEFT JOIN agents a ON u.agent_id = a.id
         WHERE date(u.recorded_at) = date('now') GROUP BY u.agent_id ORDER BY tasks DESC LIMIT 1`
      ).get() as any;

      return {
        totalTokens: totals?.totalTokens || 0,
        totalCost: totals?.totalCost || 0,
        taskCount: totals?.taskCount || 0,
        todayCost: todayTotals?.cost || 0,
        todayTokens: todayTotals?.tokens || 0,
        weekCost: weekTotals?.cost || 0,
        byAgent: byAgent || [],
        byModel: Object.fromEntries((byModel || []).map((m: any) => [m.model, { tokens: m.tokens, cost: m.cost }])),
        daily: daily || [],
        mostActiveToday: mostActiveToday || null,
      };
    } catch {
      return { totalTokens: 0, totalCost: 0, taskCount: 0, todayCost: 0, todayTokens: 0, weekCost: 0, byAgent: [], byModel: {}, daily: [], mostActiveToday: null };
    }
  });

  // Daily cost/token aggregation
  app.get('/api/usage/daily', async (req) => {
    const days = Number((req.query as any).days) || 7;
    try {
      const rows = db.prepare(`
        SELECT date(recorded_at) as date,
               SUM(cost_usd) as cost,
               SUM(total_tokens) as tokens
        FROM agent_usage
        WHERE date(recorded_at) >= date('now', '-' || ? || ' days')
        GROUP BY date(recorded_at)
        ORDER BY date ASC
      `).all(days);
      return rows;
    } catch {
      return [];
    }
  });

  // Per-agent cost breakdown
  app.get('/api/usage/by-agent', async () => {
    try {
      const rows = db.prepare(`
        SELECT u.agent_id,
               COALESCE(a.name, u.agent_id) as name,
               COALESCE(a.emoji, '🤖') as emoji,
               SUM(u.cost_usd) as cost,
               SUM(u.total_tokens) as tokens,
               COUNT(DISTINCT u.task_id) as tasks
        FROM agent_usage u
        LEFT JOIN agents a ON a.id = u.agent_id
        GROUP BY u.agent_id
        ORDER BY cost DESC
      `).all();
      return rows;
    } catch {
      return [];
    }
  });

  // Per-model cost breakdown
  app.get('/api/usage/by-model', async () => {
    try {
      const rows = db.prepare(`
        SELECT model,
               SUM(input_tokens) as input_tokens,
               SUM(output_tokens) as output_tokens,
               SUM(cache_tokens) as cache_tokens,
               SUM(total_tokens) as total_tokens,
               SUM(cost_usd) as cost
        FROM agent_usage
        GROUP BY model
        ORDER BY cost DESC
      `).all();
      return rows;
    } catch {
      return [];
    }
  });

  // Recent task usage entries
  app.get('/api/usage/recent', async (req) => {
    const limit = Number((req.query as any).limit) || 20;
    try {
      const rows = db.prepare(`
        SELECT u.agent_id,
               COALESCE(a.name, u.agent_id) as agent_name,
               COALESCE(a.emoji, '🤖') as agent_emoji,
               t.description as task_description,
               u.total_tokens, u.input_tokens, u.output_tokens, u.cache_tokens,
               u.cost_usd, u.duration_ms, u.model, u.recorded_at
        FROM agent_usage u
        LEFT JOIN agents a ON a.id = u.agent_id
        LEFT JOIN tasks t ON t.id = u.task_id
        ORDER BY u.recorded_at DESC
        LIMIT ?
      `).all(limit);
      return rows;
    } catch {
      return [];
    }
  });
}

function normalizeUsage(data: any): any {
  if (data.models && Array.isArray(data.models)) return data;
  
  const models: ModelUsage[] = [];
  let totalCost = 0;
  let totalTokens = 0;
  
  if (data.breakdown) {
    for (const [name, info] of Object.entries(data.breakdown) as any[]) {
      const m: ModelUsage = {
        name: name.split('/').pop() || name,
        tokensIn: info.input_tokens || info.tokensIn || 0,
        tokensOut: info.output_tokens || info.tokensOut || 0,
        cacheHitRatio: info.cache_hit_ratio || info.cacheHitRatio || 0,
        cost: info.cost || 0,
      };
      totalCost += m.cost;
      totalTokens += m.tokensIn + m.tokensOut;
      models.push(m);
    }
  }
  
  return {
    totalCost: data.total_cost || data.totalCost || totalCost,
    totalTokens: data.total_tokens || data.totalTokens || totalTokens,
    models,
    monthlyLimit: PLAN_PRICE,
    plan: { name: PLAN_NAME, price: PLAN_PRICE, provider: PLAN_PROVIDER },
  };
}

function getFallbackUsage() {
  return {
    totalCost: 0,
    totalTokens: 0,
    models: [] as ModelUsage[],
    monthlyLimit: PLAN_PRICE,
    plan: { name: PLAN_NAME, price: PLAN_PRICE, provider: PLAN_PROVIDER },
    fallback: true,
  };
}
