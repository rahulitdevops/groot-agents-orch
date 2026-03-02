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

-- sre_alerts table
CREATE TABLE IF NOT EXISTS sre_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric TEXT NOT NULL,
  threshold REAL NOT NULL,
  operator TEXT NOT NULL DEFAULT 'gt',
  severity TEXT NOT NULL DEFAULT 'warning',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- sre_alert_history table
CREATE TABLE IF NOT EXISTS sre_alert_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER REFERENCES sre_alerts(id),
  metric TEXT NOT NULL,
  value REAL,
  threshold REAL,
  severity TEXT,
  message TEXT,
  acknowledged INTEGER DEFAULT 0,
  triggered_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

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

-- agent_skills table
CREATE TABLE IF NOT EXISTS agent_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  skill TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'beginner',
  xp INTEGER NOT NULL DEFAULT 0,
  acquired_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_used TEXT,
  times_used INTEGER DEFAULT 0,
  UNIQUE(agent_id, skill)
);

-- agent_skill_log table
CREATE TABLE IF NOT EXISTS agent_skill_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  skill TEXT NOT NULL,
  action TEXT NOT NULL,
  old_level TEXT,
  new_level TEXT,
  xp_gained INTEGER DEFAULT 0,
  task_id INTEGER,
  logged_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- agent_usage table (cost & utilization tracking)
CREATE TABLE IF NOT EXISTS agent_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  task_id INTEGER,
  session_key TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  model TEXT,
  duration_ms INTEGER DEFAULT 0,
  recorded_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_usage_agent ON agent_usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_usage_recorded ON agent_usage(recorded_at);

-- ─── Longer-Term Improvement #1: Workflow Engine ───

-- workflows — DAG-based task orchestration
CREATE TABLE IF NOT EXISTS workflows (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'pending',   -- pending, running, paused, completed, failed, cancelled
  created_by  TEXT DEFAULT 'groot',
  trigger_task_id INTEGER,              -- original task that spawned this workflow
  created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  started_at  TEXT,
  completed_at TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);

-- workflow_steps — individual steps in a workflow DAG
CREATE TABLE IF NOT EXISTS workflow_steps (
  id          TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  description TEXT NOT NULL,
  depends_on  TEXT,                      -- JSON array of step IDs this depends on (null = no deps)
  status      TEXT DEFAULT 'pending',   -- pending, ready, running, completed, failed, skipped
  condition   TEXT,                      -- optional condition expression (e.g. "prev.evaluation == 'success'")
  task_id     INTEGER,                  -- linked task once executing
  output      TEXT,
  started_at  TEXT,
  completed_at TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_wf_steps_workflow ON workflow_steps(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_steps_status ON workflow_steps(status);

-- ─── Longer-Term Improvement #2: Shared Memory Store ───

-- shared_memory — structured key-value store agents can read/write
CREATE TABLE IF NOT EXISTS shared_memory (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace   TEXT NOT NULL,            -- e.g. 'project:groot', 'research:nextjs', 'debug:auth-issue'
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,            -- JSON string for structured data
  written_by  TEXT NOT NULL,            -- agent_id that wrote this
  task_id     INTEGER,                  -- task that produced this memory
  ttl_hours   INTEGER DEFAULT 168,      -- default 7 days TTL (null = forever)
  created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at  TEXT,
  UNIQUE(namespace, key)
);
CREATE INDEX IF NOT EXISTS idx_memory_ns ON shared_memory(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON shared_memory(written_by);
CREATE INDEX IF NOT EXISTS idx_memory_expires ON shared_memory(expires_at);

-- ─── Longer-Term Improvement #3: Agent Self-Improvement ───

-- agent_performance — track success/failure rates per agent per task type
CREATE TABLE IF NOT EXISTS agent_performance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  task_type   TEXT NOT NULL,            -- categorized from description (e.g. 'build', 'debug', 'test')
  evaluation  TEXT NOT NULL,            -- 'success', 'partial', 'failed'
  task_id     INTEGER,
  duration_ms INTEGER,
  recorded_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_perf_agent ON agent_performance(agent_id);
CREATE INDEX IF NOT EXISTS idx_perf_type ON agent_performance(task_type);

-- ─── Longer-Term Improvement #4: Human-in-the-Loop Checkpoints ───

-- checkpoints — approval gates for critical tasks
CREATE TABLE IF NOT EXISTS checkpoints (
  id          TEXT PRIMARY KEY,
  workflow_id TEXT REFERENCES workflows(id),
  step_id     TEXT REFERENCES workflow_steps(id),
  task_id     INTEGER,
  agent_id    TEXT NOT NULL,
  description TEXT NOT NULL,            -- what needs approval
  risk_level  TEXT DEFAULT 'medium',    -- low, medium, high, critical
  status      TEXT DEFAULT 'pending',   -- pending, approved, rejected, expired, auto_approved
  requested_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  responded_at TEXT,
  responded_by TEXT,                    -- 'das', 'groot_auto', etc.
  expires_at  TEXT,                     -- auto-approve after this time for low-risk
  context     TEXT                      -- JSON with task details for the human
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_status ON checkpoints(status);
CREATE INDEX IF NOT EXISTS idx_checkpoints_workflow ON checkpoints(workflow_id);
