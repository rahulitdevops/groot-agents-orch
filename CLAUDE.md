# Groot — Personal AI Agent Army
## System Specification & Developer Guide

**Last Updated:** 2026-03-03
**Project Owner:** Rahul Das (@rahuldas)
**OpenClaw Version:** 2026.3.1
**Status:** Active (Production)

---

## 📋 Executive Overview

**Groot** is an intelligent multi-agent orchestration system that runs on your local machine and is accessible via WhatsApp through OpenClaw gateway. It coordinates a team of specialized AI agents (Builder, Researcher, Debugger, QA, PM, SRE) to handle complex tasks—from coding features to monitoring infrastructure to running research.

**For AI Assistants:** This is your roadmap. Read it before making changes. Every agent has a CLAUDE.md that defines their persona and constraints. Groot itself is the supervisor agent (also has a CLAUDE.md). Your job is to work within these boundaries and follow the conventions documented here.

---

## 🏗️ Architecture

### System Layers

```
┌─────────────────────────────────────────────────────────┐
│  User Interface Layer                                   │
│  ├─ WhatsApp (primary) via OpenClaw gateway             │
│  └─ Dashboard UI (http://localhost:3333)                │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│  Supervision Layer                                      │
│  ├─ Groot Agent (supervisor logic, routing, synthesis)  │
│  └─ OpenClaw WebSocket Bridge (WhatsApp ↔ API)          │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│  Task Orchestration Layer                               │
│  ├─ Task Engine (queue, assignment, execution)          │
│  ├─ Workflow Engine (DAG-based multi-step tasks)        │
│  └─ Shared Memory Store (inter-agent context)           │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│  Agent Worker Layer                                     │
│  ├─ Builder Agent (🔨 code, features, UI)               │
│  ├─ Researcher Agent (🔍 research, analysis)            │
│  ├─ Debugger Agent (🐛 bug fixes, troubleshooting)      │
│  ├─ QA Agent (🧪 testing, verification)                 │
│  ├─ PM Agent (📋 specs, planning)                       │
│  └─ SRE Agent (🛡️ monitoring, infra)                    │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│  Persistence & Integration Layer                        │
│  ├─ SQLite Database (tasks, agents, activity logs)      │
│  ├─ Redis (session management, SSE)                     │
│  └─ File System (output artifacts, logs)                │
└─────────────────────────────────────────────────────────┘
```

### Data Flow Example: Code Feature Request

```
You (WhatsApp): "Build a login form with validation"
         ↓
Groot (supervisor): Parse intent → Plan workflow → Route agents
         ↓
[If complex] PM writes spec → Builder implements → QA tests → Groot synthesizes
[If simple] Builder implements → Groot reports
         ↓
You get WhatsApp message: "✅ Login form done — deployed to dashboard"
```

---

## 📁 Directory Structure

```
groot/
├── agents/                          # Agent worker implementations
│   ├── builder/                     # 🔨 Builder Agent
│   │   ├── CLAUDE.md               # Builder's persona & constraints
│   │   └── ...agent tools...
│   ├── researcher/                  # 🔍 Researcher Agent
│   │   ├── CLAUDE.md
│   │   └── ...agent tools...
│   ├── debugger/                    # 🐛 Debugger Agent
│   │   ├── CLAUDE.md
│   │   └── ...agent tools...
│   ├── qa/                          # 🧪 QA Agent
│   │   ├── CLAUDE.md
│   │   └── ...agent tools...
│   ├── pm/                          # 📋 PM Agent
│   │   ├── CLAUDE.md
│   │   └── ...agent tools...
│   ├── sre/                         # 🛡️ SRE Agent
│   │   ├── CLAUDE.md
│   │   └── ...agent tools...
│   ├── groot/                       # 🌱 Groot Supervisor Agent
│   │   ├── CLAUDE.md               # Groot's persona, routing logic
│   │   └── ...tools...
│   └── README.md                    # Quick reference for agents
│
├── api/                             # Fastify backend (Node.js/TypeScript)
│   ├── src/
│   │   ├── index.ts                # Server entry point
│   │   ├── db.ts                   # SQLite database connection
│   │   ├── redis.ts                # Redis client
│   │   ├── task-engine.ts          # Task queue & execution engine
│   │   ├── workflow-engine.ts       # Multi-step task orchestration
│   │   ├── shared-memory.ts         # Inter-agent context storage
│   │   ├── openclaw-ws.ts           # OpenClaw gateway bridge
│   │   ├── agent-performance.ts     # Agent metrics & analytics
│   │   ├── observability.ts         # Logging & monitoring
│   │   ├── schema.sql               # Database schema
│   │   ├── cost.ts                  # API cost calculation
│   │   └── routes/                  # API endpoints
│   │       ├── agents.js            # GET /api/agents, POST /api/tasks
│   │       ├── tasks.js             # Task management endpoints
│   │       ├── workflows.js         # Workflow endpoints
│   │       ├── memory.js            # Shared memory endpoints
│   │       ├── health.js            # Health checks
│   │       ├── gateway.js           # Gateway status
│   │       ├── system.js            # System info
│   │       ├── sre.js               # SRE checks
│   │       ├── metrics.js           # Agent performance metrics
│   │       ├── activity.js          # Activity log
│   │       ├── observability.js      # Observability data
│   │       ├── events.js            # SSE event stream
│   │       ├── search.js            # Full-text search
│   │       ├── performance.js        # Performance data
│   │       ├── config.js            # Configuration endpoints
│   │       ├── files.js             # File management
│   │       ├── webhook.js           # Webhook handlers
│   │       └── usage.js             # Usage statistics
│   ├── package.json
│   ├── pnpm-lock.yaml
│   └── tsconfig.json
│
├── dashboard/                       # Next.js frontend (React/Tailwind)
│   ├── src/
│   │   ├── app/                     # Next.js app directory
│   │   │   ├── page.tsx             # Main dashboard page
│   │   │   ├── layout.tsx           # Root layout
│   │   │   └── ...pages...
│   │   ├── components/              # React components
│   │   │   ├── TaskQueue.tsx        # Task queue visualization
│   │   │   ├── AgentStatus.tsx      # Agent status display
│   │   │   ├── MetricsChart.tsx     # Performance metrics
│   │   │   └── ...components...
│   │   ├── lib/                     # Utilities
│   │   │   ├── api.ts               # API client
│   │   │   └── hooks/               # Custom React hooks
│   │   └── styles/                  # Tailwind CSS
│   ├── public/                      # Static assets
│   ├── next.config.mjs
│   ├── tailwind.config.ts
│   ├── package.json
│   └── pnpm-lock.yaml
│
├── db/                              # Database storage
│   └── groot.db                     # SQLite database file
│
├── research/                        # Research outputs & notes
│   ├── ai-coding-tools-2025.md
│   ├── sqlite-redis-architecture.md
│   ├── nodejs-hosting-2026.md
│   └── ...research...
│
├── output/                          # Generated artifacts & reports
│   ├── pm/                          # PM agent outputs (specs, roadmaps)
│   ├── qa/                          # QA agent outputs (test reports)
│   └── sre/                         # SRE agent outputs (health checks)
│
├── .env                             # Environment variables
├── .groot.pid                       # Groot process ID (for monitoring)
├── deploy.sh                        # Deployment script
├── task-queue.json                  # Current task queue state
├── status.json                      # System status snapshot
├── EMERGENCY-FIX.md                 # Emergency procedures guide
├── openclaw-groot-review.md         # Architecture review & recommendations
├── openclaw-groot-architecture.png  # System architecture diagram
├── groot-server.log                 # Server logs
└── CLAUDE.md                        # This file

# Key Directories to Know About
- `~/projects/groot/` — Project root
- `~/.openclaw/` — OpenClaw config & workspace
- `/tmp/openclaw/` — OpenClaw logs
- `/tmp/groot-api.log` — Dashboard API logs
- `~/Library/LaunchAgents/` — System services (Gateway, Dashboard)
```

---

## 🧠 Agent System

### The Team

| Agent | Role | Icon | Model | When to Route |
|-------|------|------|-------|---------------|
| **Builder** | Feature development, bug fixes, refactoring | 🔨 | sonnet | Building/fixing code, UI changes, deployments |
| **Researcher** | Deep research, comparisons, analysis | 🔍 | sonnet | "Find out about X", market research, learning |
| **Debugger** | Root cause analysis, crash investigation | 🐛 | sonnet | Errors, crashes, "X isn't working", performance |
| **QA** | Testing, quality verification | 🧪 | sonnet | After Builder finishes, before deploy, regression |
| **PM** | Specs, planning, user stories | 📋 | sonnet | Planning features, writing specs, prioritizing |
| **SRE** | Monitoring, infra, uptime, self-healing | 🛡️ | haiku | Health checks, alerts, resource management |
| **Groot** | Supervisor, routing, orchestration, synthesis | 🌱 | opus | Receives messages, decides routing, reports results |

### Agent Personas

Each agent has a `CLAUDE.md` file that defines:
- **Role:** What they do
- **Responsibilities:** Scope of work
- **Rules:** Constraints & boundaries
- **Stack Preferences:** Technology choices
- **Output Format:** How they report results

**Location:** `agents/{agent-id}/CLAUDE.md`

**Key Principle:** When you spawn an agent (directly or via task engine), their CLAUDE.md becomes their system prompt. They operate within those boundaries.

### Groot's Special Role

Groot is different. Groot IS the main Claude session connected to WhatsApp via OpenClaw. When you send a WhatsApp message to Das, it goes directly to Groot (the main session), not to a sub-agent.

Groot's behavior is defined in `agents/groot/CLAUDE.md` and includes:
- **Intent understanding** — Parse what you actually want
- **Planning** — Break complex requests into steps
- **Routing** — Decide which agents to involve
- **Execution** — Spawn agents with their CLAUDE.md
- **Synthesis** — Read results, evaluate, report back

---

## 🔄 Task Flow

### Step 1: Message Arrives (WhatsApp → OpenClaw → Groot)

```
Das on WhatsApp: "Build a login form with email validation"
                 ↓
OpenClaw Gateway: Routes to main Claude session
                 ↓
Groot (main session): Receives message
```

### Step 2: Groot Thinks & Plans

Groot's thinking process (from `agents/groot/CLAUDE.md`):

1. **Understand Intent** — Is this a single task or multi-step?
2. **Plan Execution** — Single agent? Pipeline? Parallel?
3. **Route Agents** — Choose agents based on INTENT, not keywords
4. **Communicate** — Send clear task briefs to sub-agents

### Step 3: Task Execution

**For simple tasks (single agent):**
```
Groot → Spawn Builder with task brief
      → Builder returns output
      → Groot synthesizes & reports
```

**For complex tasks (multi-step):**
```
Groot → Create task plan (DAG)
      → Step 1: PM writes spec
      → Step 2: Builder implements (reads PM output)
      → Step 3: QA tests (reads Builder output)
      → Groot synthesizes all outputs → Report
```

### Step 4: Task Engine Execution

The `task-engine.ts` handles:
- **Queue Management** — Stores tasks in SQLite
- **Agent Assignment** — Checks agent availability
- **Sub-Agent Spawning** — Calls Claude API with agent CLAUDE.md
- **Output Storage** — Saves results to DB

Key functions:
- `enqueueTask(description, agent)` — Add task to queue
- `executeTask(task)` — Spawn agent with CLAUDE.md
- `onTaskCompleted(taskId, output)` — Handle results
- `autoAssign(description)` — ⚠️ DEPRECATED keyword routing (Groot should replace this)

### Step 5: Response to Das

Groot formats a concise WhatsApp message:
- **Status:** ✅ Done, 🔄 In Progress, ❌ Failed, ⚠️ Needs input
- **Summary:** What was done, files changed
- **Next Steps:** What's planned if not complete

---

## 🛠️ Development Workflow

### For AI Assistants Working on Groot

#### Before Making Changes

1. **Read the relevant CLAUDE.md**
   - If modifying task-engine → read `agents/groot/CLAUDE.md` first
   - If working on API → understand `agents/groot/CLAUDE.md`
   - If adding new agent → read how other agents are defined

2. **Check EMERGENCY-FIX.md**
   - Understand how the system recovers from failures
   - Know the critical paths that must not break

3. **Review openclaw-groot-review.md**
   - Understand the 7 critical issues & recommendations
   - Know what's working and what needs improvement

#### Making Changes

1. **Start in the right place:**
   - Features/bugs in agents → edit `agents/{agent}/CLAUDE.md`
   - Task orchestration problems → edit `api/src/task-engine.ts`
   - Multi-agent workflows → edit `api/src/workflow-engine.ts`
   - API endpoints → edit `api/src/routes/*.ts`
   - UI/dashboard → edit `dashboard/src/`

2. **Follow conventions:**
   - TypeScript (strict mode) in API
   - React/Next.js in dashboard
   - Keep CLAUDE.md files concise (< 200 lines)
   - Add comments only where logic is non-obvious

3. **Test your changes:**
   - If modifying API: run `pnpm dev` and test endpoints
   - If modifying agents: test task execution via dashboard
   - If modifying Groot: test via WhatsApp or dashboard

4. **Update documentation:**
   - If adding agent → create `agents/{agent}/CLAUDE.md`
   - If changing task flow → update this file
   - If critical path changes → update EMERGENCY-FIX.md

### Adding a New Agent

1. **Create agent directory:**
   ```bash
   mkdir -p agents/{agent-name}
   ```

2. **Write CLAUDE.md:**
   ```markdown
   # {Agent Name} Agent {emoji}

   You are {Agent Name} — a specialized agent under Groot's supervision.

   ## Role
   - [What you do]

   ## Rules
   - [Constraints]

   ## Output
   - [How you report results]
   ```

3. **Register in task-engine.ts:**
   - Add to `AGENTS` list
   - Add to `ROUTING_RULES` (temporary, until Groot handles routing)

4. **Test:**
   - Queue a task to new agent via API
   - Verify CLAUDE.md is injected
   - Check output is stored correctly

### Tech Stack & Tools

**Backend (API):**
- Runtime: Node.js (TypeScript)
- Framework: Fastify
- Database: SQLite
- Cache/Session: Redis
- Package Manager: pnpm

**Frontend (Dashboard):**
- Framework: Next.js 14
- UI: React 18 + Tailwind CSS
- Build: Next.js build system

**Infrastructure:**
- OpenClaw: WhatsApp gateway & main Groot session
- LaunchAgents: Service management (macOS)
- Tailscale: Remote access (optional)

**Preferred Dependencies:**
- TypeScript 5+
- Zod for validation
- Pino for logging
- ws for WebSockets

**DO NOT add without reason:**
- New package managers (pnpm is the standard)
- Large frameworks (keep it simple)
- Auth libraries (use OpenClaw's token-based auth)

---

## 🗄️ Database Schema

SQLite at `~/projects/groot/db/groot.db`

**Key Tables:**

```sql
-- Tasks: What agents are working on
tasks (id, description, agent, status, priority, output, created_at, completed_at)

-- Workflows: Multi-step task plans
workflows (id, name, status, steps_json, created_at)

-- Agents: Agent metadata & stats
agents (id, name, model, status, last_task, xp_earned)

-- Agent Skills: Agent capability tracking
agent_skills (agent_id, skill, level, xp)

-- Activity Log: Everything that happens
activity_log (id, agent, action, details, timestamp)

-- Shared Memory: Inter-agent context
shared_memory (key, value, agent_id, updated_at)
```

**For AI Assistants:**
- Read `api/src/schema.sql` for full schema
- Use `api/src/db.ts` to query (it's the DB client)
- Keep queries simple — SQLite is the source of truth

---

## 🚀 Running & Deployment

### Development

**Start everything:**
```bash
cd ~/projects/groot/api
pnpm dev  # Starts API on port 3333

# In another terminal:
cd ~/projects/groot/dashboard
pnpm dev  # Starts dashboard on port 3333 (next dev)
```

**Check status:**
```bash
curl -s http://localhost:3333/api/health | jq
openclaw status
```

**View logs:**
```bash
# API logs
tail -f /tmp/groot-api.log

# Dashboard logs
tail -f /tmp/groot-dashboard.log

# Gateway logs
cat /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | tail -50
```

### Deployment

**Script:** `~/projects/groot/deploy.sh`

**Manual deployment steps:**
1. Build API: `cd api && pnpm build`
2. Build dashboard: `cd dashboard && pnpm build`
3. Restart services: `launchctl kickstart -k gui/$(id -u)/com.groot.dashboard`
4. Verify: `curl -s http://localhost:3333/api/health`

**For emergency fixes:** See `EMERGENCY-FIX.md`

---

## 📊 Monitoring & Observability

### Health Checks

**Dashboard:** http://localhost:3333 (or http://100.109.168.87:3333 via Tailscale)

**API Health Endpoint:** `GET /api/health`
```json
{ "status": "healthy", "gateway": "connected", "db": "ok" }
```

**System Status:** `GET /api/system`
```json
{ "uptime": "...", "cpu": "...", "memory": "...", "disk": "..." }
```

### SRE Agent

**Runs every 10 minutes** (defined in `agents/sre/CLAUDE.md`):
- Checks all services
- Monitors resources
- Self-heals when possible
- Reports via WhatsApp if something breaks

**Check outputs:** `output/sre/check-YYYYMMDD-HHMM.md`

### Activity Logging

**Every action is logged:**
- Agent spawned: `"AGENT_SPAWNED", agent=builder, task=...`
- Task completed: `"TASK_COMPLETED", task_id=123, duration=...`
- Error occurred: `"AGENT_ERROR", agent=debugger, error=...`

**Query activity:** `GET /api/activity`

---

## 🔐 Security & Auth

### OpenClaw Gateway

- **Port:** 18789 (loopback only, local)
- **Auth:** Token-based (stored in `~/.openclaw/openclaw.json`)
- **Config:** See `EMERGENCY-FIX.md` for token details

### Dashboard API

- **Token:** `GROOT_DASHBOARD_TOKEN` env var
- **Protected Routes:** All `/api/*` except `/api/health`
- **Format:** `Authorization: Bearer {token}` or `?token={token}`

### Secrets

- Never commit `.env` files
- Store tokens in `~/.openclaw/openclaw.json` (encrypted by OpenClaw)
- Dashboard token in `api/.env` (local only)

---

## 🚨 Troubleshooting & Emergency Procedures

**IMPORTANT:** Read `EMERGENCY-FIX.md` before trying to fix anything.

### Common Issues

| Issue | Symptom | Fix |
|-------|---------|-----|
| Dashboard down | 500 errors | `launchctl kickstart -k gui/$(id -u)/com.groot.dashboard` |
| .next cache corrupt | Build errors | `rm -rf dashboard/.next && pnpm dev` |
| Gateway disconnected | WhatsApp not responding | `openclaw gateway restart` |
| Task queue stuck | Tasks not processing | Check `task-queue.json` and `status.json` |
| SQLite locked | `database is locked` errors | Kill other processes using DB |
| Redis connection fails | Cache errors | Check Redis is running (usually auto-starts) |

### Escalation Path

1. **Run SRE health check:** `openclaw gateway status`
2. **Check logs:** API, dashboard, gateway logs
3. **Try restart:** `openclaw gateway restart` or dashboard restart
4. **Check config:** `~/.openclaw/openclaw.json` is valid
5. **Full reset:** See `EMERGENCY-FIX.md` section "Nuclear option"

---

## 📝 Key Files & Critical Paths

| File | Purpose | Who Edits |
|------|---------|-----------|
| `agents/*/CLAUDE.md` | Agent personas & constraints | AI assistants (carefully) |
| `agents/groot/CLAUDE.md` | Groot's thinking process | AI assistants (when improving routing) |
| `api/src/task-engine.ts` | Task queue & execution | AI assistants (for task flow fixes) |
| `api/src/workflow-engine.ts` | Multi-step workflows | AI assistants (for complex task support) |
| `api/src/openclaw-ws.ts` | WhatsApp bridge | AI assistants (when fixing messaging) |
| `api/src/schema.sql` | Database schema | Rahul (migrations only) |
| `dashboard/src/app/page.tsx` | Main dashboard UI | AI assistants (UI improvements) |
| `.env` | Secrets & config | Rahul (local only) |
| `EMERGENCY-FIX.md` | Emergency procedures | Read-only (reference) |
| `CLAUDE.md` | This file | Keep updated as system evolves |

---

## 🎯 Conventions & Best Practices

### Code Style

**TypeScript:**
```typescript
// ✅ Good: Clear, typed, with comments only where needed
async function spawnAgent(agentId: string, task: string): Promise<string> {
  const agent = agents[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);

  const response = await callClaudeAPI(agent.model, {
    system: agent.claudeMd,
    messages: [{ role: 'user', content: task }]
  });
  return response.content;
}

// ❌ Bad: Unclear, missing types, too many comments
function spawnAgent(agentId, task) {
  // Check if agent exists
  const agent = agents[agentId];
  // If agent is not found, throw an error
  if (!agent) {
    // This will tell us what went wrong
    throw new Error(`Unknown agent: ${agentId}`);
  }
  // Call the Claude API
  const response = callClaudeAPI(agent.model, {
    system: agent.claudeMd,
    messages: [{ role: 'user', content: task }]
  });
  // Return the content
  return response.content;
}
```

**Naming:**
- Database tables: snake_case (`task_queue`, `agent_skills`)
- Functions: camelCase (`executeTask`, `spawnAgent`)
- Classes: PascalCase (`TaskEngine`, `WorkflowEngine`)
- Constants: UPPER_SNAKE_CASE (`MAX_RETRIES`, `DEFAULT_TIMEOUT`)

**Error Handling:**
```typescript
// Log errors with context
try {
  await executeTask(task);
} catch (err) {
  logger.error(`Failed to execute task ${task.id}: ${err.message}`);
  await notifyGroot(`Task failed: ${err.message}`);
  throw;
}
```

### CLAUDE.md Files

**Keep agent CLAUDE.md files:**
- Focused (< 200 lines)
- Actionable (clear rules, not essays)
- Updated when agent role changes
- Simple enough for LLM to follow

**Structure:**
```markdown
# {Agent Name} Agent {emoji}

You are {Agent Name} — [one-line description].

## Role
- [What you do]
- [What you're responsible for]

## Rules
- [Constraints & boundaries]
- [What NOT to do]

## Output
- [How you report results]
- [Expected format]
```

### API Design

**REST endpoints:**
- `GET /api/agents` — List agents
- `GET /api/agents/:id` — Get agent details
- `POST /api/tasks` — Queue a task
- `GET /api/tasks/:id` — Get task status
- `GET /api/health` — Health check
- `GET /api/system` — System info

**Response format:**
```json
{
  "success": true,
  "data": {...},
  "error": null
}
```

---

## 🔮 Future Roadmap (From Architecture Review)

**Priority Actions:**
1. **P0:** Replace keyword routing with LLM-based routing in Groot
2. **P0:** Improve agent CLAUDE.md files with current state injection
3. **P1:** Implement proper task output chaining between agents
4. **P1:** Add post-completion evaluation step
5. **P2:** Build workflow/DAG engine for complex multi-step tasks
6. **P2:** Implement shared memory system for inter-agent context
7. **P3:** Agent self-improvement from performance metrics

See `openclaw-groot-review.md` for detailed analysis.

---

## 🤝 Contributing to Groot

### Before You Change Anything

1. Read the relevant `CLAUDE.md` file
2. Check if you're in the right place (API vs Dashboard vs Agent)
3. Understand the data flow for your change
4. Read EMERGENCY-FIX.md to know what NOT to break

### After Making Changes

1. Test locally (pnpm dev in api & dashboard)
2. Verify no breaking changes to critical paths
3. Update documentation if behavior changed
4. Update relevant CLAUDE.md files if agent behavior changed
5. Run `pnpm build` to catch TypeScript errors

### When in Doubt

- Ask questions in code comments
- Reference the architecture diagram in this file
- Check how similar features are implemented elsewhere
- Read the task-engine.ts to understand task flow

---

## 📞 Contact & Support

**Owner:** Rahul Das (@rahuldas)
**Email:** rahul.itcloud@gmail.com
**Phone:** +917042028777
**WhatsApp:** Primary communication channel
**Dashboard:** http://localhost:3333 (or http://100.109.168.87:3333 via Tailscale)
**Timezone:** IST (Asia/Kolkata)

**For emergencies:** See `EMERGENCY-FIX.md`

---

**Last Updated:** 2026-03-03
**Maintained By:** AI Assistant Team (Claude)
**Version:** 1.0
