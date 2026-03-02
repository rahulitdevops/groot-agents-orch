import Database from 'better-sqlite3';
const db = new Database('/Users/rahuldas/projects/groot/db/groot.db');
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

db.prepare(
  'INSERT OR REPLACE INTO agents (id, name, emoji, model, tier, status, last_task, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
).run(
  'groot',
  'Groot',
  '🌱',
  'opus',
  'director',
  'idle',
  'Supervising agent army',
  now
);

console.log('✅ Added Groot agent');
db.close();
