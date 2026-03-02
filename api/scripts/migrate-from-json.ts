import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const statusPath = path.resolve(__dirname, '../../status.json');
const dbPath = path.resolve(__dirname, '../../db/groot.db');
const schemaPath = path.resolve(__dirname, '../src/schema.sql');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const statusJson = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
const db = new Database(dbPath);
db.exec(fs.readFileSync(schemaPath, 'utf-8'));

// Migrate agents
const upsertAgent = db.prepare(
  `INSERT OR REPLACE INTO agents (id, name, emoji, status, last_task) VALUES (?, ?, ?, ?, ?)`
);

const emojiMap: Record<string, string> = {
  builder: '🔨', researcher: '🔍', debugger: '🐛', qa: '🧪', sre: '🛡️'
};

for (const agent of statusJson.agents || []) {
  const emoji = emojiMap[agent.id] || '🤖';
  const name = agent.name.replace(/\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*/gu, '').trim();
  upsertAgent.run(agent.id, name, emoji, agent.status || 'idle', agent.lastTask || null);
}

// Migrate tasks
const insertTask = db.prepare(
  `INSERT OR REPLACE INTO tasks (id, agent_id, description, status, created_at) VALUES (?, ?, ?, ?, ?)`
);

for (const task of statusJson.tasks || []) {
  insertTask.run(
    parseInt(task.id),
    task.agent,
    task.description,
    task.status || 'pending',
    task.timestamp || new Date().toISOString()
  );
}

// Migrate SRE data
if (statusJson.sre) {
  const sre = statusJson.sre;
  db.prepare(
    `INSERT INTO sre_checks (dashboard_status, gateway_status, details) VALUES (?, ?, ?)`
  ).run('healthy', 'healthy', sre.details || null);
}

console.log('Migration complete!');
console.log('Agents:', db.prepare('SELECT count(*) as c FROM agents').get());
console.log('Tasks:', db.prepare('SELECT count(*) as c FROM tasks').get());
console.log('SRE checks:', db.prepare('SELECT count(*) as c FROM sre_checks').get());

db.close();
