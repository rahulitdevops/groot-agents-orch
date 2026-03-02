import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '../../db/groot.db');

// Ensure db directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Run schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// Run retention on startup
db.exec(`DELETE FROM metrics WHERE timestamp < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days')`);
db.exec(`DELETE FROM activity_log WHERE timestamp < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days')`);
db.exec(`DELETE FROM sre_checks WHERE timestamp < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-14 days')`);

export default db;
export { DB_PATH };

// Seed default alert thresholds
const alertCount = (db.prepare("SELECT COUNT(*) as c FROM sre_alerts").get() as any)?.c ?? 0;
if (alertCount === 0) {
  const insert = db.prepare("INSERT INTO sre_alerts (metric, threshold, operator, severity) VALUES (?, ?, ?, ?)");
  insert.run('cpu', 85, 'gt', 'warning');
  insert.run('cpu', 95, 'gt', 'critical');
  insert.run('memory', 80, 'gt', 'warning');
  insert.run('memory', 95, 'gt', 'critical');
  insert.run('disk', 80, 'gt', 'warning');
  insert.run('disk', 90, 'gt', 'critical');
}

// Seed agent skills
const skillCount = (db.prepare("SELECT COUNT(*) as c FROM agent_skills").get() as any)?.c ?? 0;
if (skillCount === 0) {
  const levelXp: Record<string, number> = { beginner: 0, intermediate: 100, advanced: 500, expert: 1500 };
  const seedSkills: [string, string, string][] = [
    ['builder', 'Next.js', 'advanced'], ['builder', 'React', 'advanced'], ['builder', 'TypeScript', 'advanced'],
    ['builder', 'Tailwind CSS', 'advanced'], ['builder', 'Fastify', 'intermediate'], ['builder', 'SQLite', 'intermediate'],
    ['builder', 'Node.js', 'advanced'], ['builder', 'CSS/Mobile', 'intermediate'], ['builder', 'Git', 'intermediate'],
    ['researcher', 'Web Research', 'advanced'], ['researcher', 'Technical Analysis', 'intermediate'],
    ['researcher', 'Documentation', 'intermediate'], ['researcher', 'Comparison Studies', 'intermediate'],
    ['researcher', 'Source Verification', 'beginner'],
    ['debugger', 'Error Tracing', 'advanced'], ['debugger', 'Log Analysis', 'advanced'],
    ['debugger', 'Root Cause Analysis', 'intermediate'], ['debugger', 'Minimal Fix Strategy', 'intermediate'],
    ['debugger', 'Stack Traces', 'advanced'], ['debugger', 'Process Debugging', 'intermediate'],
    ['qa', 'Build Verification', 'advanced'], ['qa', 'API Testing', 'advanced'],
    ['qa', 'Integration Testing', 'intermediate'], ['qa', 'TypeScript Checking', 'intermediate'],
    ['qa', 'Regression Testing', 'beginner'], ['qa', 'Mobile Testing', 'beginner'],
    ['sre', 'Health Monitoring', 'advanced'], ['sre', 'CPU/Memory Tracking', 'intermediate'],
    ['sre', 'Service Checks', 'advanced'], ['sre', 'Alert Management', 'beginner'],
    ['sre', 'Disk Monitoring', 'intermediate'], ['sre', 'Process Health', 'intermediate'],
    ['pm', 'Product Specs', 'advanced'], ['pm', 'User Stories', 'intermediate'],
    ['pm', 'Feature Prioritization', 'intermediate'], ['pm', 'UX Audit', 'beginner'],
    ['pm', 'Roadmap Planning', 'intermediate'], ['pm', 'Mobile-First Design', 'intermediate'],
    ['groot', 'Agent Orchestration', 'expert'], ['groot', 'Task Delegation', 'expert'],
    ['groot', 'System Architecture', 'advanced'], ['groot', 'WhatsApp Integration', 'advanced'],
    ['groot', 'Dashboard Design', 'advanced'], ['groot', 'Memory Management', 'intermediate'],
    ['groot', 'Cron Scheduling', 'intermediate'],
  ];
  const insertSkill = db.prepare("INSERT OR IGNORE INTO agent_skills (agent_id, skill, level, xp) VALUES (?, ?, ?, ?)");
  const insertLog = db.prepare("INSERT INTO agent_skill_log (agent_id, skill, action, new_level) VALUES (?, ?, 'acquired', ?)");
  const seedTx = db.transaction(() => {
    for (const [agentId, skill, level] of seedSkills) {
      insertSkill.run(agentId, skill, level, levelXp[level] || 0);
      insertLog.run(agentId, skill, level);
    }
  });
  seedTx();
}
