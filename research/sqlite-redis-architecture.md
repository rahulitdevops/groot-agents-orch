# Groot Dashboard Architecture: SQLite + Redis Upgrade

> Researcher 🔍 | 2026-03-01
> Status: Complete architecture spec for Builder 🔨 implementation

---

## 1. Database Schema (SQLite)

File location: `~/projects/groot/db/groot.db`

```sql
-- Pragmas (set on every connection)
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- agents table
CREATE TABLE IF NOT EXISTS agents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  model       TEXT DEFAULT 'claude-sonnet-4-20250514',
  tier        TEXT DEFAULT 'standard',
  status      TEXT DEFAULT 'idle',
  last_task   TEXT,
  updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id     TEXT NOT NULL REFERENCES agents(id),
  description  TEXT NOT NULL,
  status       TEXT DEFAULT 'pending',
  output       TEXT,
  created_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

-- sre_checks table
CREATE TABLE IF NOT EXISTS sre_checks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  dashboard_status TEXT,
  gateway_status   TEXT,
  cpu              REAL,
  memory           REAL,
  disk             REAL,
  details          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sre_ts ON sre_checks(timestamp);

-- metrics table (time-series)
CREATE TABLE IF NOT EXISTS metrics (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  type      TEXT NOT NULL,
  value     REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_type_ts ON metrics(type, timestamp);

-- activity_log table
CREATE TABLE IF NOT EXISTS activity_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  agent_id  TEXT REFERENCES agents(id),
  action    TEXT NOT NULL,
  details   TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(timestamp);
```

### Seed Data

```sql
INSERT INTO agents (id, name, emoji) VALUES
  ('builder',    'Builder',    '🔨'),
  ('researcher', 'Researcher', '🔍'),
  ('debugger',   'Debugger',   '🐛'),
  ('qa',         'QA',         '🧪'),
  ('sre',        'SRE',        '🛡️');
```

### Retention (run daily via cron or on startup)

```sql
DELETE FROM metrics WHERE timestamp < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days');
DELETE FROM activity_log WHERE timestamp < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days');
DELETE FROM sre_checks WHERE timestamp < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-14 days');
```

---

## 2. Redis Design

### Pub/Sub Channels

| Channel | Payload | Publisher | Subscriber |
|---------|---------|-----------|------------|
| `agent:status` | `{ agentId, status, lastTask, timestamp }` | API server | SSE handler |
| `task:update` | `{ taskId, agentId, status, output, timestamp }` | API server | SSE handler |
| `sre:check` | `{ dashboardStatus, gatewayStatus, cpu, memory, disk, timestamp }` | API server | SSE handler |

### Live Keys (quick reads, no DB hit)

| Key | Type | TTL | Value |
|-----|------|-----|-------|
| `agent:{id}:status` | STRING | none | `idle` / `working` / `error` |
| `system:health` | HASH | none | `{ cpu, memory, disk, dashboard, gateway, updatedAt }` |
| `agent:{id}:current_task` | STRING | 1h | task ID or empty |

### SSE ↔ Redis Flow

```
Browser  ←──SSE──  API Server  ←──SUBSCRIBE──  Redis
                        ↑
Groot/Agent  ──POST──→  API Server  ──PUBLISH──→  Redis
                            ↓
                        SQLite (persist)
```

1. Client opens `GET /api/events` (SSE)
2. API server subscribes to `agent:status`, `task:update`, `sre:check`
3. On Redis message → format as SSE event → write to response stream
4. On disconnect → unsubscribe, cleanup
5. 30s heartbeat keeps connection alive

---

## 3. API Design (Fastify)

Base URL: `http://localhost:3334`

### Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agents` | List all agents |
| `GET` | `/api/agents/:id` | Get single agent |
| `PATCH` | `/api/agents/:id` | Update status/model/tier |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tasks` | List tasks (`?agentId=&status=&limit=50&offset=0`) |
| `GET` | `/api/tasks/:id` | Get single task |
| `POST` | `/api/tasks` | Create task `{ agentId, description }` |
| `PATCH` | `/api/tasks/:id` | Update `{ status, output }` |

### SRE

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sre/check` | Submit SRE check |
| `GET` | `/api/sre/checks` | List recent (`?limit=20`) |
| `GET` | `/api/sre/latest` | Latest check |

### Metrics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/metrics` | Submit `{ type, value }` |
| `GET` | `/api/metrics` | Query (`?type=cpu&since=&limit=100`) |

### Activity

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/activity` | Recent activity (`?agentId=&limit=50`) |

### Webhook

```
POST /api/webhook
X-Groot-Secret: <shared-secret>

{
  "event": "agent.status" | "task.start" | "task.done" | "task.fail" | "sre.check",
  "data": { ... }
}
```

Routes events → SQLite write → Redis key set → Redis publish.

### SSE

```
GET /api/events
Accept: text/event-stream

event: agent:status
data: {"agentId":"builder","status":"working"}

event: task:update
data: {"taskId":42,"status":"done"}

event: sre:check
data: {"cpu":23.5,"memory":61.2}

event: heartbeat
data: {"ts":"..."}
```

### Health

```
GET /api/health → { status: "ok", db: true, redis: true, uptime: 3600 }
```

---

## 4. Migration Plan

### Step 1: Migration script (`api/scripts/migrate-from-json.ts`)

```typescript
import Database from 'better-sqlite3';
import fs from 'fs';

const statusJson = JSON.parse(fs.readFileSync('../status.json', 'utf-8'));
const db = new Database('../db/groot.db');
db.exec(fs.readFileSync('./src/schema.sql', 'utf-8'));

// Map status.json agents → agents table
for (const agent of statusJson.agents || []) {
  db.prepare(`INSERT OR REPLACE INTO agents (id, name, emoji, status, last_task)
    VALUES (?, ?, ?, ?, ?)`).run(agent.id, agent.name, agent.emoji, agent.status, agent.lastTask);
}
// Insert any historical tasks/SRE data if present
```

### Step 2: Backward compatibility

During transition, API writes to both SQLite AND status.json:

```typescript
if (process.env.COMPAT_STATUS_JSON === 'true') {
  const agents = db.prepare('SELECT * FROM agents').all();
  fs.writeFileSync('status.json', JSON.stringify({ agents, updatedAt: new Date() }));
}
```

### Step 3: Rollback

- status.json preserved until Phase 4 stable
- `cp db/groot.db db/groot.db.bak` before any migration
- If SQLite corrupt → restore backup, re-run migration

---

## 5. Tech Stack

| Package | Version | Purpose |
|---------|---------|---------|
| `better-sqlite3` | `11.8.1` | SQLite (sync, fast) |
| `ioredis` | `5.4.2` | Redis client + pub/sub |
| `fastify` | `5.2.1` | HTTP server |
| `@fastify/cors` | `10.0.2` | CORS |
| `@fastify/sensible` | `6.0.3` | Error helpers |
| `typescript` | `5.7.3` | TypeScript |
| `tsx` | `4.19.3` | Dev runner |
| `tsup` | `8.3.6` | Production bundler |
| `zod` | `3.24.2` | Validation |
| `pino` | `9.6.0` | Logging |

---

## 6. Directory Structure

```
~/projects/groot/
├── api/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts              # Fastify entry, port 3334
│   │   ├── db.ts                 # better-sqlite3 init + helpers
│   │   ├── redis.ts              # ioredis pub/sub setup
│   │   ├── schema.sql            # All DDL
│   │   ├── routes/
│   │   │   ├── agents.ts
│   │   │   ├── tasks.ts
│   │   │   ├── sre.ts
│   │   │   ├── metrics.ts
│   │   │   ├── activity.ts
│   │   │   ├── webhook.ts
│   │   │   ├── events.ts         # SSE endpoint
│   │   │   └── health.ts
│   │   └── services/
│   │       ├── agent-service.ts
│   │       ├── task-service.ts
│   │       └── sre-service.ts
│   └── scripts/
│       ├── migrate-from-json.ts
│       └── seed.ts
├── db/
│   └── groot.db                  # Created at runtime
├── dashboard/                    # Existing Next.js (port 3333)
│   └── src/
│       ├── hooks/useSSE.ts       # New: SSE hook
│       └── lib/api.ts            # New: API fetch helpers
├── agents/
├── status.json                   # Legacy (kept during transition)
└── .env
```

---

## 7. Implementation Phases

### Phase 1: SQLite Setup + Migration (~2-3h)

1. Init `api/` with package.json, install `better-sqlite3 typescript tsx`
2. Create `schema.sql` from §1
3. Create `db.ts` — opens DB, runs schema, exports helpers
4. Create `migrate-from-json.ts` and `seed.ts`
5. Run migration, verify data matches status.json

### Phase 2: API Server (~4-5h)

1. Install `fastify @fastify/cors zod`
2. Create Fastify server on port 3334
3. Implement all routes from §3
4. Add Zod validation on request bodies
5. Add webhook with secret validation
6. Test all endpoints with curl

### Phase 3: Redis + Real-time (~3-4h)

1. Install Redis (`brew install redis && brew services start redis`)
2. Install `ioredis`
3. Create `redis.ts` with publisher + subscriber clients
4. Update services: DB write → Redis SET + PUBLISH
5. Create SSE endpoint (`events.ts`)
6. Test: update via API, see SSE event in browser

### Phase 4: Dashboard Frontend (~5-6h)

1. Create `useSSE.ts` hook with auto-reconnect
2. Create `api.ts` fetch helpers
3. Replace status.json reads → API calls
4. Replace 5s polling → SSE
5. Add real-time UI indicators (pulse dots, toasts)
6. Add task history view, SRE metrics charts
7. Remove status.json dependency

### Phase 5: QA + SRE Integration (~3-4h)

1. Update SRE cron: POST to `/api/sre/check` instead of writing status.json
2. Update all agent scripts to use API
3. QA: concurrent writes, SSE reconnect, Redis-down fallback, DB backup/restore
4. Remove `COMPAT_STATUS_JSON`
5. Archive status.json

---

## 8. Local Setup Commands

### Redis

```bash
# Install
brew install redis

# Start as service (auto-start on boot)
brew services start redis

# Verify
redis-cli ping   # → PONG

# Stop
brew services stop redis
```

Brew auto-creates LaunchAgent at `~/Library/LaunchAgents/homebrew.mxcl.redis.plist`.

### API Server LaunchAgent

Save to `~/Library/LaunchAgents/com.groot.api.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.groot.api</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/rahuldas/projects/groot/api/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/rahuldas/projects/groot/api</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DB_PATH</key>
    <string>/Users/rahuldas/projects/groot/db/groot.db</string>
    <key>REDIS_URL</key>
    <string>redis://localhost:6379</string>
    <key>API_PORT</key>
    <string>3334</string>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/groot-api.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/groot-api-error.log</string>
</dict>
</plist>
```

---

## Environment Variables

```bash
# ~/projects/groot/.env
DB_PATH=./db/groot.db
REDIS_URL=redis://localhost:6379
API_PORT=3334
GROOT_WEBHOOK_SECRET=change-me-to-random-string
COMPAT_STATUS_JSON=true
```

---

## Key Design Decisions

1. **Fastify > Express** — 2-3x faster, better TS, built-in validation
2. **SSE > WebSocket** — Simpler, auto-reconnect via EventSource API, sufficient for server→client push
3. **better-sqlite3 (sync)** — No race conditions, WAL mode handles concurrent reads, perfect for single-machine
4. **Redis pub/sub** — Instant propagation, decouples writers from SSE readers
5. **Separate API (3334) from Dashboard (3333)** — Independent deploys/restarts
6. **Webhook pattern** — Single ingestion point for all agents, clean routing

## Graceful Degradation

- **Redis down:** API still works (SQLite). SSE returns error, dashboard falls back to 5s polling.
- **API down:** Dashboard shows "disconnected" banner, retries every 5s.
- **SQLite corrupt:** Restore from `db/groot.db.bak`, re-migrate from status.json if needed.
