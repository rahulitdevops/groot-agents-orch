import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db from '../db.js';
import { publishEvent } from '../redis.js';

const SreCheckBody = z.object({
  dashboard_status: z.string().optional(),
  gateway_status: z.string().optional(),
  cpu: z.number().optional(),
  memory: z.number().optional(),
  disk: z.number().optional(),
  details: z.string().optional(),
});

function getMetricValue(check: any, metric: string): number | null {
  if (metric === 'cpu') return check.cpu ?? null;
  if (metric === 'memory') return check.memory ?? null;
  if (metric === 'disk') return check.disk ?? null;
  return null;
}

function shouldTrigger(value: number | null, threshold: number, operator: string): boolean {
  if (value == null) return false;
  if (operator === 'gt') return value > threshold;
  if (operator === 'lt') return value < threshold;
  if (operator === 'eq') return value === threshold;
  return false;
}

export default async function sreRoutes(app: FastifyInstance) {
  app.post('/api/sre/check', async (req, reply) => {
    const body = SreCheckBody.parse(req.body);
    const result = db.prepare(
      `INSERT INTO sre_checks (dashboard_status, gateway_status, cpu, memory, disk, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(body.dashboard_status ?? null, body.gateway_status ?? null,
      body.cpu ?? null, body.memory ?? null, body.disk ?? null, body.details ?? null);

    db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)').run(
      'sre', 'sre_check', JSON.stringify(body)
    );

    const check = db.prepare('SELECT * FROM sre_checks WHERE id = ?').get(result.lastInsertRowid) as any;

    // Evaluate alerts
    const alerts = db.prepare("SELECT * FROM sre_alerts WHERE enabled = 1").all() as any[];
    for (const alert of alerts) {
      const value = getMetricValue(check, alert.metric);
      if (shouldTrigger(value, alert.threshold, alert.operator)) {
        db.prepare("INSERT INTO sre_alert_history (alert_id, metric, value, threshold, severity, message) VALUES (?,?,?,?,?,?)")
          .run(alert.id, alert.metric, value, alert.threshold, alert.severity,
            `${alert.metric} at ${value}% exceeds ${alert.operator} ${alert.threshold}%`);
        try {
          publishEvent('groot:sre', {
            type: 'sre:alert', metric: alert.metric, value, threshold: alert.threshold, severity: alert.severity
          });
        } catch {}
      }
    }

    return reply.status(201).send(check);
  });

  app.get<{ Querystring: { limit?: string } }>('/api/sre/checks', async (req) => {
    const limit = parseInt(req.query.limit || '20');
    return db.prepare('SELECT * FROM sre_checks ORDER BY timestamp DESC LIMIT ?').all(limit);
  });

  app.get('/api/sre/latest', async (_req, reply) => {
    const check = db.prepare('SELECT * FROM sre_checks ORDER BY timestamp DESC LIMIT 1').get();
    if (!check) return reply.status(404).send({ error: 'No SRE checks found' });
    return check;
  });

  // --- Alert Rules CRUD ---
  app.get('/api/sre/alerts', async () => {
    return db.prepare('SELECT * FROM sre_alerts ORDER BY metric, severity').all();
  });

  app.post('/api/sre/alerts', async (req, reply) => {
    const { metric, threshold, operator, severity, enabled } = req.body as any;
    const result = db.prepare(
      "INSERT INTO sre_alerts (metric, threshold, operator, severity, enabled) VALUES (?,?,?,?,?)"
    ).run(metric, threshold, operator ?? 'gt', severity ?? 'warning', enabled ?? 1);
    return reply.status(201).send(db.prepare('SELECT * FROM sre_alerts WHERE id = ?').get(result.lastInsertRowid));
  });

  app.patch<{ Params: { id: string } }>('/api/sre/alerts/:id', async (req, reply) => {
    const { threshold, enabled, severity, operator } = req.body as any;
    const existing = db.prepare('SELECT * FROM sre_alerts WHERE id = ?').get(parseInt(req.params.id)) as any;
    if (!existing) return reply.status(404).send({ error: 'Alert not found' });
    db.prepare(
      "UPDATE sre_alerts SET threshold = ?, enabled = ?, severity = ?, operator = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
    ).run(
      threshold ?? existing.threshold,
      enabled ?? existing.enabled,
      severity ?? existing.severity,
      operator ?? existing.operator,
      parseInt(req.params.id)
    );
    return db.prepare('SELECT * FROM sre_alerts WHERE id = ?').get(parseInt(req.params.id));
  });

  app.delete<{ Params: { id: string } }>('/api/sre/alerts/:id', async (req, reply) => {
    const result = db.prepare('DELETE FROM sre_alerts WHERE id = ?').run(parseInt(req.params.id));
    if (result.changes === 0) return reply.status(404).send({ error: 'Alert not found' });
    return { ok: true };
  });

  // --- Alert History ---
  app.get<{ Querystring: { limit?: string } }>('/api/sre/alert-history', async (req) => {
    const limit = parseInt(req.query.limit || '20');
    return db.prepare('SELECT * FROM sre_alert_history ORDER BY triggered_at DESC LIMIT ?').all(limit);
  });

  app.post<{ Params: { id: string } }>('/api/sre/alert-history/:id/ack', async (req, reply) => {
    const result = db.prepare('UPDATE sre_alert_history SET acknowledged = 1 WHERE id = ?').run(parseInt(req.params.id));
    if (result.changes === 0) return reply.status(404).send({ error: 'Alert history entry not found' });
    return { ok: true };
  });

  // --- Self-Healing Actions ---
  app.get<{ Querystring: { limit?: string } }>('/api/sre/self-healing', async (req) => {
    const limit = parseInt(req.query.limit || '20');
    return db.prepare(
      `SELECT * FROM activity_log
       WHERE action LIKE '%self_heal%' OR action LIKE '%restart%' OR action LIKE '%recover%' OR action LIKE '%auto_fix%'
       ORDER BY timestamp DESC LIMIT ?`
    ).all(limit);
  });

  // --- Metrics Trends ---
  app.get<{ Querystring: { hours?: string } }>('/api/sre/metrics/trends', async (req) => {
    const hours = parseInt(req.query.hours || '24');
    return db.prepare(
      `SELECT timestamp, cpu, memory, disk, dashboard_status, gateway_status
       FROM sre_checks
       WHERE timestamp >= datetime('now', '-' || ? || ' hours')
       ORDER BY timestamp ASC`
    ).all(hours);
  });

  // --- Health Score ---
  app.get('/api/sre/health-score', async () => {
    const latest = db.prepare('SELECT * FROM sre_checks ORDER BY timestamp DESC LIMIT 1').get() as any;
    if (!latest) return { score: null, breakdown: {} };

    let score = 100;
    const breakdown: Record<string, number> = {};

    // CPU weight 30
    if (latest.cpu != null) {
      const p = Math.max(0, (latest.cpu - 50) * 0.6);
      breakdown.cpu = Math.max(0, Math.round(30 - p));
      score -= Math.min(30, p);
    } else { breakdown.cpu = 30; }

    // Memory weight 30
    if (latest.memory != null) {
      const p = Math.max(0, (latest.memory - 50) * 0.6);
      breakdown.memory = Math.max(0, Math.round(30 - p));
      score -= Math.min(30, p);
    } else { breakdown.memory = 30; }

    // Disk weight 20
    if (latest.disk != null) {
      const p = Math.max(0, (latest.disk - 60) * 0.5);
      breakdown.disk = Math.max(0, Math.round(20 - p));
      score -= Math.min(20, p);
    } else { breakdown.disk = 20; }

    // Services weight 20
    const dashOk = latest.dashboard_status === 'ok' || latest.dashboard_status === 'pass';
    const gwOk = latest.gateway_status === 'ok' || latest.gateway_status === 'online';
    breakdown.services = (dashOk ? 10 : 0) + (gwOk ? 10 : 0);
    score -= (20 - breakdown.services);

    return { score: Math.max(0, Math.round(score)), breakdown };
  });
}
