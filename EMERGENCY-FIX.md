# 🚨 Emergency Fix Guide for Groot (OpenClaw Gateway)

> **OpenClaw Version:** 2026.3.1
> **Last updated:** 2026-03-03

## Who is this for?
Another AI agent (Claude CLI, Claude Desktop, ChatGPT, etc.) helping Das fix Groot when he's not responding on WhatsApp.

---

## For Claude CLI Agents

If Das asks you to fix Groot using Claude CLI (`claude`), here's how:

### Run Claude CLI with context
```bash
cd ~/projects/groot
claude --print "Read EMERGENCY-FIX.md and diagnose why Groot/OpenClaw is down. Run the diagnostic steps and fix it."
```

### Interactive mode (for complex issues)
```bash
cd ~/projects/groot
claude
# Then paste: "Groot is down. Follow EMERGENCY-FIX.md to diagnose and fix."
```

### Key things Claude CLI needs to know
- It has full shell access — can run all `openclaw` commands directly
- It should read this file first, then follow the steps below
- It can edit `~/.openclaw/openclaw.json` if config is broken
- It should NOT run `nohup openclaw gateway &` — use `openclaw gateway start`
- After fixing, verify with `openclaw status`

---

## Quick Diagnosis

### Step 1: Check if gateway is running
```bash
openclaw gateway status
```
- If running → jump to Step 3
- If not running → Step 2

### Step 2: Start gateway
```bash
openclaw gateway start
```
If this fails, check logs:
```bash
cat /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | tail -50
```

### Step 3: Check overall status
```bash
openclaw status
```
This shows gateway, channels, sessions, and security audit.

For deeper diagnostics:
```bash
openclaw status --deep
```

### Step 4: Fix broken config
If config is corrupted, restore to a known-good state:
```bash
# Backup current broken config
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.broken
```

Edit config:
```bash
nano ~/.openclaw/openclaw.json
```

Key fields that MUST be correct:
```json
"gateway": {
  "port": 18789,
  "mode": "local",
  "bind": "loopback",
  "auth": {
    "mode": "token",
    "token": "03683b69e5ff9a58087ed0d17c9812b1fa60e32a6315b529"
  }
}
```

Then restart:
```bash
openclaw gateway restart
```

### Step 5: If WhatsApp is disconnected
```bash
openclaw gateway restart
```
WhatsApp session is persisted, should auto-reconnect. If not:
```bash
openclaw onboard
```
And re-scan QR code.

### Step 6: If Groot Dashboard is down
```bash
# Check if running
curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/api/health

# If not running, the LaunchAgent should auto-start it:
launchctl kickstart gui/$(id -u)/com.groot.dashboard

# If better-sqlite3 fails (Node version mismatch after update):
cd ~/projects/groot/api && pnpm rebuild better-sqlite3
launchctl kickstart -k gui/$(id -u)/com.groot.dashboard
```

### Step 7: If Tailscale is down
```bash
tailscale up
tailscale status
```
MacBook IP: `100.109.168.87`

### Step 8: Nuclear option (full reset)
```bash
openclaw gateway stop
openclaw onboard
```
This re-runs setup wizard. Keep existing config when asked.

---

## Important Paths

| What | Path |
|------|------|
| OpenClaw config | `~/.openclaw/openclaw.json` |
| OpenClaw logs | `/tmp/openclaw/openclaw-YYYY-MM-DD.log` |
| OpenClaw workspace | `~/.openclaw/workspace/` |
| Groot project | `~/projects/groot/` |
| Dashboard API | `~/projects/groot/api/src/` |
| Dashboard frontend | `~/projects/groot/dashboard/src/` |
| Dashboard DB | `~/projects/groot/db/groot.db` |
| API logs | `/tmp/groot-api.log` |
| Gateway LaunchAgent | `~/Library/LaunchAgents/ai.openclaw.gateway.plist` |
| Dashboard LaunchAgent | `~/Library/LaunchAgents/com.groot.dashboard.plist` |
| Claude CLI | `~/.local/bin/claude` (v2.1.63) |

## Services (LaunchAgents)

| Service | Label | Auto-start | KeepAlive |
|---------|-------|------------|-----------|
| OpenClaw Gateway | `ai.openclaw.gateway` | Yes | Yes |
| Groot Dashboard | `com.groot.dashboard` | Yes | Yes |

## Quick Commands
```bash
# OpenClaw
openclaw gateway start|stop|restart|status
openclaw status
openclaw update

# Dashboard
curl -s http://localhost:3333/api/health  # should return 200
launchctl kickstart -k gui/$(id -u)/com.groot.dashboard  # force restart

# Tailscale
tailscale up
tailscale status

# Claude CLI (for another agent to use)
claude --print "your prompt here"   # one-shot
claude                               # interactive
```

## DO NOT
- ❌ Run `nohup openclaw gateway &` — conflicts with LaunchAgent
- ❌ Delete `~/.openclaw/` — that's everything
- ❌ Change auth token without noting it down
- ❌ Run `npm install` in groot/api — use `pnpm`
- ❌ Kill the LaunchAgent plist — use `openclaw gateway stop`

## Das's Info
- Phone: +917042028777
- WhatsApp: primary channel
- Model: anthropic/claude-opus-4-6
- Dashboard: http://localhost:3333 (or http://100.109.168.87:3333 via Tailscale)
