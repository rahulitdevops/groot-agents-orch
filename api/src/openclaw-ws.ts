import { onTaskCompleted, processQueue } from './task-engine.js';
import { registerSessionKiller } from './workflow-engine.js';
import { writeMemory } from './shared-memory.js';
import WebSocket from 'ws';
import db from './db.js';
import { publishEvent } from './redis.js';
import { calculateCost } from './cost.js';

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

if (!GATEWAY_URL) {
  throw new Error('OPENCLAW_GATEWAY_URL environment variable is required');
}
if (!GATEWAY_TOKEN) {
  throw new Error('OPENCLAW_GATEWAY_TOKEN environment variable is required');
}

const AGENT_PREFIX_MAP: Record<string, string> = {
  builder: 'builder',
  debugger: 'debugger',
  qa: 'qa',
  researcher: 'researcher',
  sre: 'sre',
  pm: 'pm',
};

function labelToAgentId(label: string): string | null {
  if (!label) return null;
  const lower = label.toLowerCase();
  for (const [prefix, agentId] of Object.entries(AGENT_PREFIX_MAP)) {
    if (lower.startsWith(prefix)) return agentId;
  }
  return null;
}

/** Check if a sessionKey is a subagent session */
function isSubagentSession(sessionKey: string): boolean {
  return sessionKey.includes('subagent:');
}

interface SessionInfo {
  key: string;
  label?: string;
  agentId?: string;
  taskId?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export class OpenClawBridge {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private _connected = false;
  private reconnectDelay = 5000;
  private connectNonce: string | null = null;
  private pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private reqId = 0;
  private lastSync: string | null = null;
  private pollingActive = false;
  private trackedSessions = new Map<string, SessionInfo>();
  private sessionLastActivity = new Map<string, number>();
  private gatewayVersion: string | null = null;
  private syncInProgress = false;

  get connected() { return this._connected; }

  get status() {
    return {
      wsConnected: this._connected,
      pollingActive: this.pollingActive,
      lastSync: this.lastSync,
      gatewayVersion: this.gatewayVersion,
      activeSessions: this.trackedSessions.size,
      trackedSessionKeys: Array.from(this.trackedSessions.keys()),
    };
  }

  start() {
    console.log('[OpenClawBridge] Starting connection to', GATEWAY_URL);
    this.connect();
  }

  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.syncInterval) { clearInterval(this.syncInterval); this.syncInterval = null; }
    this.ws?.close();
    this.ws = null;
    this._connected = false;
    this.pollingActive = false;
  }

  private connect() {
    try {
      this.ws = new WebSocket(GATEWAY_URL);
    } catch (err) {
      console.error('[OpenClawBridge] Failed to create WebSocket:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log('[OpenClawBridge] WebSocket opened, waiting for challenge...');
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (err) {
        console.error('[OpenClawBridge] Failed to parse message:', err);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[OpenClawBridge] WebSocket closed: ${code} ${reason?.toString()}`);
      this._connected = false;
      if (this.syncInterval) { clearInterval(this.syncInterval); this.syncInterval = null; }
      this.flushPending(new Error('ws closed'));
      this.startPolling();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[OpenClawBridge] WebSocket error:', err.message);
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(this.reconnectDelay, 60000);
    console.log(`[OpenClawBridge] Reconnecting in ${delay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 60000);
      this.connect();
    }, delay);
  }

  private handleMessage(msg: any) {
    if (msg.type === 'event') {
      if (msg.event === 'connect.challenge') {
        this.connectNonce = msg.payload?.nonce || null;
        if (this.connectNonce) this.sendConnect();
        return;
      }
      this.handleEvent(msg);
      return;
    }

    if (msg.type === 'res') {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.ok) pending.resolve(msg.payload);
        else pending.reject(new Error(msg.error?.message || 'request failed'));
      }
    }
  }

  private async sendConnect() {
    try {
      const result = await this.request('connect', {
        minProtocol: 3,
        maxProtocol: 3,
        client: { id: 'gateway-client', version: '1.0.0', platform: 'node', mode: 'backend' },
        role: 'operator',
        scopes: ['operator.admin'],
        caps: [],
        auth: { token: GATEWAY_TOKEN },
      });

      this._connected = true;
      this.reconnectDelay = 5000;
      this.stopPolling();

      if (result?.server?.version) this.gatewayVersion = result.server.version;
      console.log('[OpenClawBridge] Connected to gateway!', this.gatewayVersion ? `v${this.gatewayVersion}` : '');

      // Initial sync
      await this.syncSessions();
      
      // Reconcile: any agents marked "running" in DB but not tracked → set idle
      this.reconcileStaleAgents();

      // Start periodic sync every 15s
      if (this.syncInterval) clearInterval(this.syncInterval);
      this.syncInterval = setInterval(() => this.syncSessions(), 15000);
      console.log('[OpenClawBridge] Periodic session sync started (every 15s)');
    } catch (err) {
      console.error('[OpenClawBridge] Connect failed:', err);
      this.ws?.close(1008, 'connect failed');
    }
  }

  /** Public method for task engine to send WS requests */
  sendRequest(method: string, params?: any): Promise<any> {
    return this.request(method, params);
  }

  private request(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('not connected'));
        return;
      }
      const id = `groot-${++this.reqId}`;
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('request timeout'));
        }
      }, 10000);
    });
  }

  private flushPending(err: Error) {
    for (const [, p] of this.pendingRequests) p.reject(err);
    this.pendingRequests.clear();
  }

  private handleEvent(msg: any) {
    const event = msg.event;
    const payload = msg.payload;
    const sessionKey = payload?.sessionKey || payload?.key || '';

    // Only log subagent-related events to reduce noise
    if (isSubagentSession(sessionKey)) {
      console.log(`[OpenClawBridge] Event: ${event} sessionKey=${sessionKey}`, JSON.stringify(payload || {}).substring(0, 300));
    }

    if (event === 'agent') this.handleAgentEvent(payload);
    if (event === 'chat') this.handleChatEvent(payload);
  }

  private handleAgentEvent(payload: any) {
    if (!payload) return;
    const sessionKey = payload.sessionKey || payload.key || '';

    // Track last activity time for stale detection
    this.sessionLastActivity.set(sessionKey, Date.now());
    // Only care about subagent sessions
    if (!isSubagentSession(sessionKey)) return;

    // If we haven't seen this subagent session, trigger a sync to discover it via sessions.list
    // (streaming events don't carry labels, but sessions.list does)
    if (!this.trackedSessions.has(sessionKey)) {
      console.log(`[OpenClawBridge] New subagent session detected via event: ${sessionKey}, triggering sync...`);
      this.syncSessions();
    }
  }

  private handleChatEvent(payload: any) {
    if (!payload) return;
    const sessionKey = payload.sessionKey || '';

    if (isSubagentSession(sessionKey) && !this.trackedSessions.has(sessionKey)) {
      this.syncSessions();
    }
  }

  private onSessionStarted(sessionKey: string, agentId: string, label: string) {
    // Deduplicate: check if we already have a running task for this agent+label
    const existing = db.prepare("SELECT id FROM tasks WHERE agent_id = ? AND description = ? AND status = 'running'").get(agentId, label.substring(0, 500)) as any;
    if (existing) {
      console.log(`[OpenClawBridge] Session already tracked for ${agentId} (${label}), reusing task ${existing.id}`);
      this.trackedSessions.set(sessionKey, { key: sessionKey, label, agentId, taskId: existing.id });
      return;
    }

    console.log(`[OpenClawBridge] Session started: ${agentId} (${label})`);

    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (agent) {
      db.prepare("UPDATE agents SET status = 'running', last_task = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?")
        .run(label.substring(0, 200), agentId);
    }

    const result = db.prepare('INSERT INTO tasks (agent_id, description, status) VALUES (?, ?, ?)').run(agentId, label.substring(0, 500), 'running');
    const taskId = Number(result.lastInsertRowid);

    db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)').run(agentId, 'session_started', label);

    this.trackedSessions.set(sessionKey, { key: sessionKey, label, agentId, taskId });
    this.lastSync = new Date().toISOString();

    publishEvent('groot:agent', { type: 'agent:status', agentId, status: 'running', label });
    publishEvent('groot:task', { type: 'task:update', taskId, status: 'running' });
  }

  private onSessionCompleted(sessionKey: string, agentId: string) {
    const tracked = this.trackedSessions.get(sessionKey);
    if (!tracked) return;

    console.log(`[OpenClawBridge] Session completed: ${agentId}`);

    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (agent) {
      db.prepare("UPDATE agents SET status = 'idle', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(agentId);
    }

    if (tracked.taskId) {
      db.prepare("UPDATE tasks SET status = 'completed', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(tracked.taskId);
    }

    db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)').run(agentId, 'session_completed', tracked.label || sessionKey);

    // Record usage if we have token data
    this.recordUsage(tracked, sessionKey);

    this.trackedSessions.delete(sessionKey);
    this.lastSync = new Date().toISOString();

    publishEvent('groot:agent', { type: 'agent:status', agentId, status: 'idle' });
    publishEvent('groot:task', { type: 'task:update', taskId: tracked.taskId, status: 'completed' });

    // Notify task engine so queued tasks can proceed (also triggers performance + workflow hooks)
    if (tracked.taskId) onTaskCompleted(tracked.taskId);

    // Store task output in shared memory for cross-agent context
    if (tracked.taskId && tracked.label) {
      const task = db.prepare('SELECT output FROM tasks WHERE id = ?').get(tracked.taskId) as any;
      if (task?.output) {
        try {
          writeMemory(agentId, `task-${tracked.taskId}`, task.output.substring(0, 2000), agentId, {
            taskId: tracked.taskId, ttlHours: 48,
          });
        } catch (err) {
          console.warn(`[OpenClawBridge] Failed to write task output to shared memory:`, err);
        }
      }
    }

    processQueue().catch(console.error);
  }

  private onSessionFailed(sessionKey: string, agentId: string) {
    const tracked = this.trackedSessions.get(sessionKey);
    if (!tracked) return;

    console.log(`[OpenClawBridge] Session failed: ${agentId}`);

    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (agent) {
      db.prepare("UPDATE agents SET status = 'idle', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(agentId);
    }

    if (tracked.taskId) {
      db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(tracked.taskId);
    }

    db.prepare('INSERT INTO activity_log (agent_id, action, details) VALUES (?, ?, ?)').run(agentId, 'session_failed', tracked.label || sessionKey);

    this.trackedSessions.delete(sessionKey);
    this.lastSync = new Date().toISOString();

    publishEvent('groot:agent', { type: 'agent:status', agentId, status: 'idle' });
    publishEvent('groot:task', { type: 'task:update', taskId: tracked.taskId, status: 'failed' });
  }

  async syncSessions() {
    if (this.syncInProgress) return;
    this.syncInProgress = true;
    try {
      const result = await this.request('sessions.list', {
        activeMinutes: 10, limit: 50,
      });
      const sessions = result?.sessions || [];

      console.log(`[OpenClawBridge] Sync: found ${sessions.length} subagent sessions`);
      for (const session of sessions) {
        const label = session.label || '';
        const key = session.key || '';
        const status = session.status || '';
        console.log(`[OpenClawBridge]   session: key=${key} label="${label}" status=${status}`);

        const agentId = labelToAgentId(label);
        if (!agentId) continue;

        if (!this.trackedSessions.has(key)) {
          if (status === 'failed' || status === 'error') {
            console.log(`[OpenClawBridge]   Skipping already-failed session: ${key}`);
            continue;
          }
          this.onSessionStarted(key, agentId, label);
        }
      }

      // Detect completed: tracked but no longer in active list OR no events for 30s
      const activeKeys = new Set(sessions.map((s: any) => s.key));
      const now = Date.now();
      for (const [key, tracked] of this.trackedSessions) {
        const lastActivity = this.sessionLastActivity.get(key) || 0;
        const stale = lastActivity > 0 && (now - lastActivity) > 120000; // no events for 30s
        const notInList = !activeKeys.has(key);
        
        if ((notInList || stale) && tracked.agentId) {
          console.log(`[OpenClawBridge] Session completed (notInList=${notInList}, stale=${stale}): ${tracked.agentId}`);
          this.onSessionCompleted(key, tracked.agentId);
          this.sessionLastActivity.delete(key);
        }
      }

      // Update Groot supervisor status based on main session activity
      const mainSession = sessions.find((s: any) => (s.key || '').includes('whatsapp:direct'));
      if (mainSession) {
        const grootAgent = db.prepare("SELECT status FROM agents WHERE id = 'groot'").get() as any;
        if (grootAgent && grootAgent.status !== 'running') {
          db.prepare("UPDATE agents SET status = 'running', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = 'groot'").run();
        }
      }

      this.lastSync = new Date().toISOString();
    } catch (err) {
      console.error('[OpenClawBridge] Session sync failed:', err);
    } finally {
      this.syncInProgress = false;
    }
  }

  public killTaskSession(taskId: number): void {
    // Find the tracked session for this task
    let sessionKey: string | null = null;
    for (const [key, tracked] of this.trackedSessions) {
      if (tracked.taskId === taskId) { sessionKey = key; break; }
    }
    if (sessionKey) {
      const tracked = this.trackedSessions.get(sessionKey)!;
      this.trackedSessions.delete(sessionKey);       // prevent completion callback
      this.sessionLastActivity.delete(sessionKey);
      this.request('sessions.kill', { key: sessionKey }).catch(() => {}); // best-effort
      const stillRunning = [...this.trackedSessions.values()].some(s => s.agentId === tracked.agentId);
      if (!stillRunning) {
        db.prepare("UPDATE agents SET status = 'idle', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?")
          .run(tracked.agentId);
        publishEvent('groot:agent', { type: 'agent:status', agentId: tracked.agentId, status: 'idle' });
      }
      console.log(`[OpenClawBridge] Killed session ${sessionKey} for task #${taskId}`);
    }
    // Mark task cancelled in DB regardless (covers pre-spawn case too)
    db.prepare("UPDATE tasks SET status = 'cancelled' WHERE id = ? AND status IN ('running', 'in_progress')")
      .run(taskId);
  }

  private recordUsage(tracked: SessionInfo, sessionKey: string) {
    try {
      const agentId = tracked.agentId || 'unknown';
      const agent = db.prepare('SELECT model FROM agents WHERE id = ?').get(agentId) as any;
      const model = agent?.model || 'opus';
      // Estimate duration from task creation
      let durationMs = 0;
      if (tracked.taskId) {
        const task = db.prepare('SELECT created_at FROM tasks WHERE id = ?').get(tracked.taskId) as any;
        if (task?.created_at) {
          durationMs = Date.now() - new Date(task.created_at).getTime();
        }
      }
      // We don't have per-session token breakdowns from sessions.list, so estimate
      // based on typical usage. Real tracking will improve over time.
      const totalTokens = 0; // Will be populated when available from session data
      const inputTokens = 0;
      const outputTokens = 0;
      const cacheTokens = 0;
      const costUsd = calculateCost(model, inputTokens, outputTokens, cacheTokens);

      db.prepare(
        `INSERT INTO agent_usage (agent_id, task_id, session_key, input_tokens, output_tokens, cache_tokens, total_tokens, cost_usd, model, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(agentId, tracked.taskId || null, sessionKey, inputTokens, outputTokens, cacheTokens, totalTokens, costUsd, model, durationMs);

      console.log(`[OpenClawBridge] Recorded usage for ${agentId}: ${totalTokens} tokens, $${costUsd.toFixed(4)}, ${Math.round(durationMs/1000)}s`);
    } catch (err) {
      console.error('[OpenClawBridge] Failed to record usage:', err);
    }
  }

  private reconcileStaleAgents() {
    const runningAgents = db.prepare("SELECT id, last_task FROM agents WHERE status = 'running' OR status = 'working'").all() as any[];
    const trackedAgentIds = new Set([...this.trackedSessions.values()].map(s => s.agentId));
    
    for (const agent of runningAgents) {
      // Skip Groot — managed separately via main session detection
      if (agent.id === 'groot') continue;
      if (!trackedAgentIds.has(agent.id)) {
        console.log(`[OpenClawBridge] Reconcile: agent ${agent.id} marked running but no active session → idle`);
        db.prepare("UPDATE agents SET status = 'idle', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(agent.id);
        db.prepare("UPDATE tasks SET status = 'completed', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE agent_id = ? AND status IN ('running', 'pending')").run(agent.id);
        publishEvent('groot:agent', { type: 'agent:status', agentId: agent.id, status: 'idle' });
      }
    }
  }

  private startPolling() {
    if (this.pollingActive) return;
    console.log('[OpenClawBridge] Starting polling fallback (30s)');
    this.pollingActive = true;
    this.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(GATEWAY_URL.replace('ws://', 'http://').replace('wss://', 'https://'), { signal: AbortSignal.timeout(5000) });
        if (res.ok) this.connect();
      } catch { /* gateway still down */ }
    }, 30000);
  }

  private stopPolling() {
    if (!this.pollingActive) return;
    console.log('[OpenClawBridge] Stopping polling, WS reconnected');
    this.pollingActive = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }
}

export const openclawBridge = new OpenClawBridge();
registerSessionKiller((taskId) => openclawBridge.killTaskSession(taskId));
