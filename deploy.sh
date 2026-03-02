#!/usr/bin/env bash
#
# deploy.sh — OpenClaw Groot: Full Deployment Script
# Handles deps, build, env setup, DB migration, and server start.
#
# Usage:
#   ./deploy.sh              # Full deploy (install + build + start)
#   ./deploy.sh install      # Install dependencies only
#   ./deploy.sh build        # Build dashboard only
#   ./deploy.sh start        # Start the API server only
#   ./deploy.sh stop         # Stop running server
#   ./deploy.sh restart      # Stop + Start
#   ./deploy.sh status       # Show running processes
#   ./deploy.sh logs         # Tail the server log
#   ./deploy.sh health       # Quick health check
#
set -euo pipefail

# ── Resolve project root (where this script lives) ──────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

API_DIR="$SCRIPT_DIR/api"
DASH_DIR="$SCRIPT_DIR/dashboard"
DB_DIR="$SCRIPT_DIR/db"
LOG_FILE="$SCRIPT_DIR/groot-server.log"
PID_FILE="$SCRIPT_DIR/.groot.pid"

# ── Colours ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }
header(){ echo -e "\n${BOLD}═══ $* ═══${NC}"; }

# ── Detect package manager ──────────────────────────────────────────
detect_pm() {
  if command -v pnpm &>/dev/null; then echo "pnpm"
  elif command -v npm &>/dev/null; then echo "npm"
  else err "Neither pnpm nor npm found. Install Node.js first."; exit 1
  fi
}

# ── Pre-flight checks ───────────────────────────────────────────────
preflight() {
  header "Pre-flight checks"

  # Node.js
  if ! command -v node &>/dev/null; then
    err "Node.js not found. Install Node.js 18+ first."
    exit 1
  fi
  local node_ver
  node_ver=$(node -v | sed 's/v//' | cut -d. -f1)
  if (( node_ver < 18 )); then
    err "Node.js 18+ required (found v$(node -v))"
    exit 1
  fi
  ok "Node.js $(node -v)"

  # Package manager
  PM=$(detect_pm)
  ok "Package manager: $PM"

  # tsx (will be installed via deps, but check if globally available)
  if command -v tsx &>/dev/null; then
    ok "tsx available globally"
  else
    info "tsx will run via npx after install"
  fi

  # Redis (optional)
  if command -v redis-cli &>/dev/null && redis-cli ping &>/dev/null 2>&1; then
    ok "Redis is running (SSE events enabled)"
  else
    warn "Redis not available — SSE events will be disabled (non-blocking)"
  fi
}

# ── Environment setup ────────────────────────────────────────────────
setup_env() {
  header "Environment"

  if [ ! -f "$API_DIR/.env" ]; then
    info "Creating api/.env with a fresh dashboard token..."
    local token
    token=$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | xxd -p 2>/dev/null | head -c 48 || echo "change-me-$(date +%s)")
    cat > "$API_DIR/.env" <<EOF
# Groot Dashboard auth token (send as Bearer token or ?token= query param)
GROOT_DASHBOARD_TOKEN=$token

# API port (default 3333)
# API_PORT=3333

# Database path (default: ../db/groot.db)
# DB_PATH=

# Redis URL (optional, SSE degrades gracefully without it)
# REDIS_URL=redis://localhost:6379
EOF
    ok "Created api/.env — token: $token"
    warn "Save this token! You'll need it to access the dashboard."
  else
    ok "api/.env already exists"
  fi

  # Ensure db directory
  mkdir -p "$DB_DIR"
  ok "Database directory ready: $DB_DIR"
}

# ── Install dependencies ─────────────────────────────────────────────
install_deps() {
  header "Installing dependencies"

  info "Installing API dependencies..."
  cd "$API_DIR"
  $PM install

  # Rebuild native modules (better-sqlite3) for current platform/Node version
  info "Rebuilding native modules for $(uname -m) / Node $(node -v)..."
  if $PM rebuild better-sqlite3 2>/dev/null || npm rebuild better-sqlite3 2>/dev/null; then
    ok "Native modules rebuilt"
  else
    warn "Native module rebuild failed — trying fresh install..."
    rm -rf node_modules/.pnpm/better-sqlite3* node_modules/better-sqlite3 2>/dev/null || true
    $PM install
  fi
  ok "API dependencies installed"

  info "Installing Dashboard dependencies..."
  cd "$DASH_DIR"
  $PM install
  ok "Dashboard dependencies installed"

  cd "$SCRIPT_DIR"
}

# ── Build dashboard ──────────────────────────────────────────────────
build_dashboard() {
  header "Building dashboard"

  cd "$DASH_DIR"

  # Check if out/ already exists and is recent (< 5 min old)
  if [ -d "out" ] && [ -f "out/index.html" ]; then
    local age
    age=$(( $(date +%s) - $(stat -c %Y "out/index.html" 2>/dev/null || stat -f %m "out/index.html" 2>/dev/null || echo 0) ))
    if (( age < 300 )); then
      ok "Dashboard build is fresh (${age}s old) — skipping"
      cd "$SCRIPT_DIR"
      return
    fi
  fi

  info "Running Next.js static export..."
  if $PM run build; then
    ok "Dashboard built → dashboard/out/"
  else
    warn "Dashboard build failed — API will still work, but no UI"
  fi

  cd "$SCRIPT_DIR"
}

# ── Start server ─────────────────────────────────────────────────────
start_server() {
  header "Starting Groot API server"

  # Check if already running
  if is_running; then
    warn "Server is already running (PID $(cat "$PID_FILE"))"
    warn "Use './deploy.sh restart' to restart"
    return
  fi

  cd "$API_DIR"

  # Determine how to run tsx
  local tsx_cmd
  if command -v tsx &>/dev/null; then
    tsx_cmd="tsx"
  elif [ -x "node_modules/.bin/tsx" ]; then
    tsx_cmd="node_modules/.bin/tsx"
  else
    tsx_cmd="npx tsx"
  fi

  info "Starting with: $tsx_cmd src/index.ts"
  nohup $tsx_cmd src/index.ts > "$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  # Wait for server to be ready
  info "Waiting for server..."
  local attempts=0
  while (( attempts < 20 )); do
    if curl -sf http://localhost:${API_PORT:-3333}/api/health > /dev/null 2>&1; then
      echo ""
      ok "Server is running on http://localhost:${API_PORT:-3333} (PID $pid)"

      # Print token reminder
      local token
      token=$(grep GROOT_DASHBOARD_TOKEN "$API_DIR/.env" 2>/dev/null | cut -d= -f2)
      if [ -n "$token" ]; then
        info "Dashboard token: $token"
        info "Dashboard URL:   http://localhost:${API_PORT:-3333}?token=$token"
      fi
      cd "$SCRIPT_DIR"
      return
    fi
    sleep 0.5
    printf "."
    (( attempts++ ))
  done

  echo ""
  err "Server did not start within 10s. Check logs:"
  err "  tail -f $LOG_FILE"
  cd "$SCRIPT_DIR"
  exit 1
}

# ── Stop server ──────────────────────────────────────────────────────
stop_server() {
  header "Stopping Groot server"

  if ! is_running; then
    warn "No running server found"
    return
  fi

  local pid
  pid=$(cat "$PID_FILE")
  info "Stopping PID $pid..."
  kill "$pid" 2>/dev/null || true

  # Wait for process to exit
  local attempts=0
  while kill -0 "$pid" 2>/dev/null && (( attempts < 10 )); do
    sleep 0.5
    (( attempts++ ))
  done

  if kill -0 "$pid" 2>/dev/null; then
    warn "Graceful shutdown failed, force killing..."
    kill -9 "$pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
  ok "Server stopped"
}

# ── Rebuild native modules ───────────────────────────────────────────
rebuild_native() {
  header "Rebuilding native modules"

  cd "$API_DIR"
  info "Rebuilding better-sqlite3 for $(uname -m) / Node $(node -v)..."

  # Always do a clean delete + reinstall for native modules
  # pnpm rebuild can silently skip recompilation due to content-addressable store
  info "Removing cached native modules..."
  rm -rf node_modules/.pnpm/better-sqlite3* node_modules/better-sqlite3 2>/dev/null || true
  rm -rf node_modules/.pnpm/@esbuild* node_modules/esbuild 2>/dev/null || true

  # Also clear pnpm store cache for better-sqlite3 if using pnpm
  if command -v pnpm &>/dev/null; then
    pnpm store prune 2>/dev/null || true
  fi

  info "Reinstalling..."
  $PM install
  ok "Native modules reinstalled for Node $(node -v)"

  # Verify the binary works
  info "Verifying better-sqlite3..."
  if node -e "require('better-sqlite3')" 2>/dev/null; then
    ok "better-sqlite3 binary OK"
  else
    err "better-sqlite3 still broken — try: npm install better-sqlite3 --build-from-source"
  fi

  cd "$SCRIPT_DIR"
}

# ── Check if server is running ───────────────────────────────────────
is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

# ── Status ───────────────────────────────────────────────────────────
show_status() {
  header "Groot Status"

  if is_running; then
    local pid
    pid=$(cat "$PID_FILE")
    ok "Server is running (PID $pid)"

    # Health check
    local port=${API_PORT:-3333}
    if curl -sf "http://localhost:$port/api/health" > /dev/null 2>&1; then
      ok "Health check: OK"
    else
      warn "Health check: FAILED (port $port)"
    fi

    # DB size
    if [ -f "$DB_DIR/groot.db" ]; then
      local size
      size=$(du -sh "$DB_DIR/groot.db" | cut -f1)
      info "Database size: $size"
    fi

    # Log tail
    if [ -f "$LOG_FILE" ]; then
      info "Last 3 log lines:"
      tail -3 "$LOG_FILE" | sed 's/^/  /'
    fi
  else
    warn "Server is not running"
  fi
}

# ── Health check ─────────────────────────────────────────────────────
health_check() {
  local port=${API_PORT:-3333}
  local token
  token=$(grep GROOT_DASHBOARD_TOKEN "$API_DIR/.env" 2>/dev/null | cut -d= -f2)

  header "Health Check"

  # Basic health (no auth needed)
  if curl -sf "http://localhost:$port/api/health" > /dev/null 2>&1; then
    ok "API health endpoint: OK"
  else
    err "API health endpoint: FAILED"
    return 1
  fi

  # Authenticated endpoints
  if [ -n "$token" ]; then
    local endpoints=("agents" "tasks" "performance" "memory" "observability/summary")
    for ep in "${endpoints[@]}"; do
      if curl -sf -H "Authorization: Bearer $token" "http://localhost:$port/api/$ep" > /dev/null 2>&1; then
        ok "/api/$ep: OK"
      else
        warn "/api/$ep: FAILED"
      fi
    done
  fi
}

# ── Show logs ────────────────────────────────────────────────────────
show_logs() {
  if [ -f "$LOG_FILE" ]; then
    tail -f "$LOG_FILE"
  else
    warn "No log file found at $LOG_FILE"
  fi
}

# ── Full deploy ──────────────────────────────────────────────────────
full_deploy() {
  echo -e "${BOLD}"
  echo "  ╔═══════════════════════════════════════╗"
  echo "  ║   🌳  OpenClaw Groot — Deploy  🌳    ║"
  echo "  ╚═══════════════════════════════════════╝"
  echo -e "${NC}"

  preflight
  setup_env
  install_deps
  build_dashboard
  start_server

  header "Deployment Complete"
  echo ""
  info "Useful commands:"
  echo "  ./deploy.sh status    — Check server status"
  echo "  ./deploy.sh logs      — Tail server logs"
  echo "  ./deploy.sh health    — Run health checks"
  echo "  ./deploy.sh restart   — Restart the server"
  echo "  ./deploy.sh stop      — Stop the server"
  echo ""
}

# ── Main ─────────────────────────────────────────────────────────────
case "${1:-}" in
  install)
    preflight
    install_deps
    ;;
  build)
    PM=$(detect_pm)
    build_dashboard
    ;;
  start)
    PM=$(detect_pm)
    start_server
    ;;
  stop)
    stop_server
    ;;
  restart)
    PM=$(detect_pm)
    stop_server
    start_server
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs
    ;;
  health)
    health_check
    ;;
  rebuild)
    PM=$(detect_pm)
    rebuild_native
    ;;
  help|-h|--help)
    echo "Usage: ./deploy.sh [command]"
    echo ""
    echo "Commands:"
    echo "  (none)    Full deploy: install + build + start"
    echo "  install   Install dependencies only"
    echo "  build     Build dashboard only"
    echo "  start     Start the API server"
    echo "  stop      Stop the running server"
    echo "  restart   Stop + start"
    echo "  rebuild   Rebuild native modules (fixes ERR_DLOPEN_FAILED)"
    echo "  status    Show server status"
    echo "  logs      Tail server logs"
    echo "  health    Run health checks on all endpoints"
    echo "  help      Show this help"
    ;;
  *)
    full_deploy
    ;;
esac
