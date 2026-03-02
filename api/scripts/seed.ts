import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../db/groot.db');
const schemaPath = path.resolve(__dirname, '../src/schema.sql');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.exec(fs.readFileSync(schemaPath, 'utf-8'));

const upsert = db.prepare(
  `INSERT OR IGNORE INTO agents (id, name, emoji) VALUES (?, ?, ?)`
);

const agents = [
  ['builder', 'Builder', '🔨'],
  ['researcher', 'Researcher', '🔍'],
  ['debugger', 'Debugger', '🐛'],
  ['qa', 'QA', '🧪'],
  ['sre', 'SRE', '🛡️'],
];

for (const [id, name, emoji] of agents) {
  upsert.run(id, name, emoji);
}

console.log('Seed complete!');
console.log('Agents:', db.prepare('SELECT * FROM agents').all());

db.close();
