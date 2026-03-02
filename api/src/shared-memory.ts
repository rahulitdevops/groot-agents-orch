/**
 * Shared Memory Store — Agent-accessible structured data
 *
 * A team wiki/knowledge base where agents write structured outputs
 * that other agents can query. Think of it as a shared context layer.
 *
 * Namespaces organize data (e.g. 'project:groot', 'debug:auth-bug', 'research:nextjs15')
 *
 * Longer-Term Improvement #2
 */

import db from './db.js';
import { publishEvent } from './redis.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: number;
  namespace: string;
  key: string;
  value: any;         // parsed JSON
  writtenBy: string;
  taskId: number | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

// ---------------------------------------------------------------------------
// Write to shared memory (upsert)
// ---------------------------------------------------------------------------

export function writeMemory(
  namespace: string,
  key: string,
  value: any,
  writtenBy: string,
  opts?: { taskId?: number; ttlHours?: number }
): MemoryEntry {
  const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
  const ttlHours = opts?.ttlHours ?? 168; // default 7 days
  const expiresAt = ttlHours > 0
    ? new Date(Date.now() + ttlHours * 3600 * 1000).toISOString()
    : null;

  db.prepare(`
    INSERT INTO shared_memory (namespace, key, value, written_by, task_id, ttl_hours, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(namespace, key) DO UPDATE SET
      value = excluded.value,
      written_by = excluded.written_by,
      task_id = excluded.task_id,
      updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
      expires_at = excluded.expires_at
  `).run(namespace, key, valueStr, writtenBy, opts?.taskId || null, ttlHours, expiresAt);

  const entry = db.prepare('SELECT * FROM shared_memory WHERE namespace = ? AND key = ?')
    .get(namespace, key) as any;

  publishEvent('groot:memory', {
    type: 'memory:updated',
    namespace,
    key,
    writtenBy,
  });

  console.log(`[SharedMemory] ${writtenBy} wrote ${namespace}/${key} (${valueStr.length} bytes)`);
  return formatEntry(entry);
}

// ---------------------------------------------------------------------------
// Read from shared memory
// ---------------------------------------------------------------------------

export function readMemory(namespace: string, key: string): MemoryEntry | null {
  cleanExpired();
  const entry = db.prepare('SELECT * FROM shared_memory WHERE namespace = ? AND key = ?')
    .get(namespace, key) as any;
  return entry ? formatEntry(entry) : null;
}

// ---------------------------------------------------------------------------
// List entries in a namespace
// ---------------------------------------------------------------------------

export function listMemory(namespace: string): MemoryEntry[] {
  cleanExpired();
  const entries = db.prepare(
    'SELECT * FROM shared_memory WHERE namespace = ? ORDER BY updated_at DESC'
  ).all(namespace) as any[];
  return entries.map(formatEntry);
}

// ---------------------------------------------------------------------------
// Search across namespaces
// ---------------------------------------------------------------------------

export function searchMemory(query: string, opts?: { namespace?: string; writtenBy?: string; limit?: number }): MemoryEntry[] {
  cleanExpired();
  let sql = 'SELECT * FROM shared_memory WHERE 1=1';
  const params: any[] = [];

  if (opts?.namespace) {
    sql += ' AND namespace LIKE ?';
    params.push(`%${opts.namespace}%`);
  }
  if (opts?.writtenBy) {
    sql += ' AND written_by = ?';
    params.push(opts.writtenBy);
  }
  if (query) {
    sql += ' AND (key LIKE ? OR value LIKE ? OR namespace LIKE ?)';
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  sql += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(opts?.limit || 20);

  const entries = db.prepare(sql).all(...params) as any[];
  return entries.map(formatEntry);
}

// ---------------------------------------------------------------------------
// List all namespaces with counts
// ---------------------------------------------------------------------------

export function listNamespaces(): Array<{ namespace: string; count: number; lastUpdated: string }> {
  cleanExpired();
  return db.prepare(`
    SELECT namespace, COUNT(*) as count, MAX(updated_at) as lastUpdated
    FROM shared_memory
    GROUP BY namespace
    ORDER BY lastUpdated DESC
  `).all() as any[];
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export function deleteMemory(namespace: string, key: string): boolean {
  const result = db.prepare('DELETE FROM shared_memory WHERE namespace = ? AND key = ?')
    .run(namespace, key);
  return result.changes > 0;
}

export function deleteNamespace(namespace: string): number {
  const result = db.prepare('DELETE FROM shared_memory WHERE namespace = ?').run(namespace);
  return result.changes;
}

// ---------------------------------------------------------------------------
// Build context string for agent prompts
// ---------------------------------------------------------------------------

/**
 * Get relevant memory entries for an agent's task as a context string.
 * This is injected into the agent's prompt so it has access to team knowledge.
 */
export function getMemoryContextForTask(agentId: string, description: string): string {
  cleanExpired();

  // Get all memory entries this agent has written (their own notes)
  const ownEntries = db.prepare(`
    SELECT namespace, key, value FROM shared_memory
    WHERE written_by = ?
    ORDER BY updated_at DESC LIMIT 5
  `).all(agentId) as any[];

  // Search for entries relevant to the task description
  const words = description.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  let relevantEntries: any[] = [];
  if (words.length > 0) {
    // Use first few meaningful words to search
    const searchTerms = words.slice(0, 5);
    for (const term of searchTerms) {
      const found = db.prepare(`
        SELECT namespace, key, value, written_by FROM shared_memory
        WHERE (key LIKE ? OR value LIKE ? OR namespace LIKE ?)
        AND written_by != ?
        ORDER BY updated_at DESC LIMIT 3
      `).all(`%${term}%`, `%${term}%`, `%${term}%`, agentId) as any[];
      relevantEntries.push(...found);
    }
    // Deduplicate
    const seen = new Set<string>();
    relevantEntries = relevantEntries.filter(e => {
      const k = `${e.namespace}/${e.key}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 5);
  }

  if (ownEntries.length === 0 && relevantEntries.length === 0) return '';

  const parts: string[] = [];

  if (ownEntries.length > 0) {
    parts.push('Your previous notes:');
    for (const e of ownEntries) {
      parts.push(`  [${e.namespace}/${e.key}]: ${e.value.substring(0, 300)}`);
    }
  }

  if (relevantEntries.length > 0) {
    parts.push('Team knowledge (from other agents):');
    for (const e of relevantEntries) {
      parts.push(`  [${e.written_by} → ${e.namespace}/${e.key}]: ${e.value.substring(0, 300)}`);
    }
  }

  return '\n\n--- Shared Memory ---\n' + parts.join('\n') + '\n--- End Shared Memory ---\n';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEntry(row: any): MemoryEntry {
  let value = row.value;
  try { value = JSON.parse(row.value); } catch { /* plain string */ }
  return {
    id: row.id,
    namespace: row.namespace,
    key: row.key,
    value,
    writtenBy: row.written_by,
    taskId: row.task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

function cleanExpired() {
  db.prepare("DELETE FROM shared_memory WHERE expires_at IS NOT NULL AND expires_at < strftime('%Y-%m-%dT%H:%M:%SZ','now')")
    .run();
}
