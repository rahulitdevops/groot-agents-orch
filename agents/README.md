# Groot's Agent Army 🌱

## Supervisor: Groot (OpenClaw/WhatsApp)
Controls all agents, assigns tasks, monitors progress.

## Active Agents

| Agent | Dir | Status |
|-------|-----|--------|
| 🔨 Builder | agents/builder/ | Ready |
| 🔍 Researcher | agents/researcher/ | Ready |
| 🐛 Debugger | agents/debugger/ | Ready |

## How It Works

1. Das gives task to Groot (WhatsApp)
2. Groot picks the right agent(s)
3. Groot spawns sub-agent with the agent's CLAUDE.md as context
4. Agent does the work
5. Groot reports back to Das

## Adding New Agents
Create a new dir in agents/ with a CLAUDE.md defining:
- Role & responsibilities
- Rules & constraints
- Expected output format

## Planned Agents
- 📝 Writer — docs, emails, content
- 🧪 Tester — test writing, QA
- 👁️ Monitor — periodic checks, alerts
- 📊 Analyst — data analysis, reports
