# Groot — Multi-Agent Orchestration System 🌱

An intelligent personal AI agent army that runs on your local machine, accessible via WhatsApp through [OpenClaw](https://github.com/openclawai/openclaw) gateway. Groot supervises a team of specialized agents to handle complex tasks—from coding features to infrastructure monitoring to deep research.

**Latest:** v2026.3.1 | **Status:** Active/Production | **Architecture Review:** [openclaw-groot-review.md](openclaw-groot-review.md)

## 🎯 What is Groot?

Groot is a **supervisor agent** that:
- 🧠 **Understands intent** — Parses what you actually want, not just keywords
- 📋 **Plans workflows** — Breaks complex requests into multi-step pipelines
- 🤖 **Routes agents** — Decides which agents to involve based on intent
- 🔄 **Orchestrates** — Chains agent outputs, manages dependencies
- 📊 **Monitors** — Tracks agent performance, system health, costs
- 📱 **Communicates** — Reports results back to you via WhatsApp

### The Agent Team

| Agent | Role | Icon | When to Use |
|-------|------|------|-------------|
| **Builder** | Feature development, bug fixes, refactoring | 🔨 | Building/fixing code, UI changes |
| **Researcher** | Deep research, analysis, comparisons | 🔍 | "Find out about X", market research |
| **Debugger** | Root cause analysis, crash investigation | 🐛 | Errors, "X isn't working", performance |
| **QA** | Testing, quality verification | 🧪 | After building, before deploy |
| **PM** | Specs, planning, user stories | 📋 | Planning features, roadmaps |
| **SRE** | Monitoring, infra, uptime, self-healing | 🛡️ | Health checks, alerts, maintenance |

## 🏗️ Architecture

```
WhatsApp → OpenClaw Gateway → Groot (Supervisor)
                                  ↓
                          ┌───────┴───────┐
                          ↓               ↓
                    Plan Workflow    Route Agents
                          ↓               ↓
                    [Multi-Step DAG] [Builder, Researcher, etc.]
                          ↓               ↓
                    Task Engine ← ← ← ← ←┤
                          ↓
                    [SQLite DB + Redis]
                          ↓
                    Dashboard UI (localhost:3333)
```

**4 Layers:**
1. **User Interface** — WhatsApp (primary) + Dashboard UI
2. **Supervision** — Groot agent with routing logic
3. **Orchestration** — Task engine, workflow engine, shared memory
4. **Workers** — 6 specialized agents + monitoring
5. **Persistence** — SQLite database, Redis cache, file system

## 🚀 Quick Start

### Prerequisites
- macOS (with LaunchAgents support)
- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Redis (for caching/sessions)
- [OpenClaw CLI](https://github.com/openclawai/openclaw) installed & configured

### Setup

```bash
# Clone repo
git clone https://github.com/rahulitdevops/groot-agents-orch.git
cd groot

# Install dependencies
cd api && pnpm install
cd ../dashboard && pnpm install
cd ..

# Create .env files
cp api/.env.example api/.env
cp dashboard/.env.example dashboard/.env

# Initialize database
cd api && pnpm run seed  # (optional, seeds test data)
cd ..
```

### Running

**Terminal 1 — API Server:**
```bash
cd api
pnpm dev  # Starts on http://localhost:3333
```

**Terminal 2 — Dashboard:**
```bash
cd dashboard
pnpm dev  # Starts on http://localhost:3333
```

**Access:**
- Dashboard: http://localhost:3333
- API: http://localhost:3333/api/
- Health check: `curl http://localhost:3333/api/health`

### Using via WhatsApp

1. Configure OpenClaw with your WhatsApp account
2. Send a message to the WhatsApp bot
3. Groot receives it, routes to appropriate agent(s), returns results

## 📁 Project Structure

```
groot/
├── agents/                    # Agent worker implementations
│   ├── builder/              # 🔨 Builder Agent
│   ├── researcher/           # 🔍 Researcher Agent
│   ├── debugger/             # 🐛 Debugger Agent
│   ├── qa/                   # 🧪 QA Agent
│   ├── pm/                   # 📋 PM Agent
│   ├── sre/                  # 🛡️ SRE Agent
│   └── groot/                # 🌱 Groot Supervisor
│
├── api/                       # Fastify backend (TypeScript)
│   ├── src/
│   │   ├── task-engine.ts    # Task queue & execution
│   │   ├── workflow-engine.ts # Multi-step workflows
│   │   ├── openclaw-ws.ts    # WhatsApp bridge
│   │   ├── shared-memory.ts  # Inter-agent context
│   │   ├── routes/           # API endpoints
│   │   └── ...
│   └── package.json
│
├── dashboard/                 # Next.js frontend (React)
│   ├── src/
│   │   ├── app/              # Pages
│   │   ├── components/        # React components
│   │   └── views/            # Page views
│   └── package.json
│
├── db/                        # SQLite database
│   └── groot.db
│
├── CLAUDE.md                  # System spec & developer guide
├── EMERGENCY-FIX.md           # Emergency procedures
├── openclaw-groot-review.md   # Architecture analysis
└── README.md                  # This file
```

## 🔄 How It Works

### Example: "Build a login form with email validation"

```
1. You (WhatsApp):  "Build a login form with email validation"
                    ↓
2. Groot (thinks):  Intent: Build feature
                    Plan: PM writes spec → Builder implements → QA tests
                    ↓
3. Step 1 (PM):     Writes spec for login form
                    (Output: spec.md)
                    ↓
4. Step 2 (Builder): Reads PM's spec, implements form
                    (Output: code + file paths)
                    ↓
5. Step 3 (QA):    Reads Builder's changes, tests form
                    (Output: test results)
                    ↓
6. Groot:          Synthesizes all outputs
                    ↓
7. You get:        ✅ Login form built & tested
                    - Files: src/components/LoginForm.tsx, validation.ts
                    - Tests: 12 passed
                    - Deployed to dashboard
```

## 🔌 API Endpoints

### Core
- `GET /api/health` — Health check
- `GET /api/system` — System info (uptime, CPU, memory)
- `GET /api/status` — Overall system status

### Tasks
- `POST /api/tasks` — Queue a task
- `GET /api/tasks` — List tasks
- `GET /api/tasks/:id` — Get task details

### Agents
- `GET /api/agents` — List all agents
- `GET /api/agents/:id` — Get agent details
- `GET /api/agents/:id/skills` — Agent skills & XP

### Workflows
- `POST /api/workflows` — Create a workflow
- `GET /api/workflows` — List workflows
- `GET /api/workflows/:id` — Get workflow details

### Monitoring
- `GET /api/metrics` — Agent performance metrics
- `GET /api/activity` — Activity log
- `GET /api/sre` — SRE health checks
- `GET /api/events` — SSE event stream

## 🛠️ Configuration

### Environment Variables

**API (.env in `api/`):**
```bash
API_PORT=3333
CLAUDE_API_KEY=sk-...
DASHBOARD_TOKEN=...
```

**Dashboard (.env in `dashboard/`):**
```bash
NEXT_PUBLIC_API_URL=http://localhost:3333
```

### OpenClaw Gateway

Configuration stored in `~/.openclaw/openclaw.json`:
```json
{
  "gateway": {
    "port": 18789,
    "mode": "local",
    "auth": {
      "mode": "token",
      "token": "..."
    }
  }
}
```

## 📊 Monitoring & Observability

### Dashboard
Access at http://localhost:3333 to see:
- Real-time agent status
- Task queue & history
- System metrics (CPU, memory, disk)
- Activity log
- SRE health checks

### Logs
- API logs: `/tmp/groot-api.log`
- Dashboard logs: `/tmp/groot-dashboard.log`
- Gateway logs: `/tmp/openclaw/openclaw-YYYY-MM-DD.log`

### Health Checks
SRE agent runs automatic health checks every 10 minutes:
- Service status (dashboard, gateway)
- Process health
- Resource usage
- Log analysis
- Self-healing (auto-restart failed services)

## 🚨 Emergency Procedures

If something breaks, read **[EMERGENCY-FIX.md](EMERGENCY-FIX.md)** first.

**Quick diagnostics:**
```bash
# Check gateway status
openclaw gateway status

# Check API health
curl -s http://localhost:3333/api/health | jq

# View logs
tail -f /tmp/groot-api.log
tail -f /tmp/groot-dashboard.log
```

## 🔐 Security

- **OpenClaw Token:** Stored securely in `~/.openclaw/openclaw.json`
- **Dashboard Token:** `GROOT_DASHBOARD_TOKEN` env var (local only)
- **Database:** SQLite with no auth (local-only development)
- **API Auth:** Token-based on protected routes
- **Never commit:** `.env` files with secrets

## 🔮 Future Roadmap

From [openclaw-groot-review.md](openclaw-groot-review.md):

**Priority Actions:**
- [ ] Replace keyword routing with LLM-based routing
- [ ] Implement proper task output chaining
- [ ] Build DAG-based workflow engine
- [ ] Add shared memory system
- [ ] Implement agent self-improvement
- [ ] Add human-in-the-loop checkpoints

## 📚 Documentation

- **[CLAUDE.md](CLAUDE.md)** — Complete system specification & developer guide
- **[EMERGENCY-FIX.md](EMERGENCY-FIX.md)** — Emergency procedures & troubleshooting
- **[openclaw-groot-review.md](openclaw-groot-review.md)** — Architecture review & recommendations
- **[agents/*/CLAUDE.md](agents)** — Individual agent personas & rules

## 🤝 Contributing

This is Rahul's personal project, but contributions are welcome!

1. Read [CLAUDE.md](CLAUDE.md) first
2. Understand the architecture in this README
3. Check [EMERGENCY-FIX.md](EMERGENCY-FIX.md) to know what not to break
4. Make your changes
5. Test locally (`pnpm dev`)
6. Submit a PR

## 📞 Contact

- **Communication:** WhatsApp (primary channel)
- **Timezone:** IST (Asia/Kolkata)
- **For Issues:** Open a GitHub issue in the repository

## 📜 License

MIT

---

**Built with Claude AI** 🤖 | **Powered by OpenClaw** 🔗

**Last Updated:** March 3, 2026
