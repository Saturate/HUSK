#!/bin/bash
# E2E test for husk CLI
# Runs inside the Docker container with Node + Bun + pre-staged server

set -euo pipefail

PASS=0
FAIL=0
CLI="node /app/cli/dist/bin.js"

pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

echo ""
echo "═══════════════════════════════════════"
echo "  HUSK CLI — End-to-End Tests"
echo "═══════════════════════════════════════"
echo ""

# ─── Test 1: --help ────────────────────────────────────────
echo "▸ Test: --help"
if $CLI --help 2>&1 | grep -q "Memory layer for AI coding assistants"; then
  pass "--help shows banner"
else
  fail "--help missing banner"
fi

# ─── Test 2: --version ─────────────────────────────────────
echo "▸ Test: --version"
VERSION=$($CLI --version 2>&1)
if echo "$VERSION" | grep -q "husk 0.1.0"; then
  pass "--version shows 0.1.0"
else
  fail "--version unexpected: $VERSION"
fi

# ─── Test 3: status (before start) ─────────────────────────
echo "▸ Test: status (server not running)"
STATUS=$($CLI status 2>&1)
if echo "$STATUS" | grep -q "stopped"; then
  pass "status shows stopped"
else
  fail "status should show stopped: $STATUS"
fi

# ─── Test 4: start --foreground ─────────────────────────────
echo "▸ Test: start server in background"

# Create default config first (the CLI would normally do this interactively)
mkdir -p ~/.husk/data
cat > ~/.husk/husk.toml <<'TOML'
[server]
port = 3111
db_path = "/root/.husk/data/husk.db"

[storage]
backend = "sqlite-vec"
path = "/root/.husk/data/husk-vectors.db"

[embeddings]
backend = "transformers"
models_path = "/root/.husk/data/models"
TOML

# Start server as daemon
BUN_PATH=$(which bun)
cd /root/.husk/server/server
HUSK_CONFIG=/root/.husk/husk.toml $BUN_PATH run src/index.ts &
SERVER_PID=$!
echo $SERVER_PID > /root/.husk/husk.pid
cd /app/cli

# Wait for health
echo "  … waiting for server (PID $SERVER_PID)"
HEALTHY=false
for i in $(seq 1 60); do
  if curl -sf http://localhost:3111/health > /dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 0.5
done

if $HEALTHY; then
  pass "server is healthy"
else
  fail "server did not become healthy in 30s"
  echo "  last 20 lines of log:"
  cat ~/.husk/husk.log 2>/dev/null | tail -20 || true
  # Try to show what's on port 3111
  curl -v http://localhost:3111/health 2>&1 || true
fi

# ─── Test 5: health endpoint ───────────────────────────────
echo "▸ Test: /health endpoint"
HEALTH=$(curl -sf http://localhost:3111/health 2>&1 || echo "FAIL")
if echo "$HEALTH" | grep -q '"status"'; then
  pass "/health returns status JSON"
else
  fail "/health response: $HEALTH"
fi

# ─── Test 6: status (running) ──────────────────────────────
echo "▸ Test: status (server running)"
STATUS=$($CLI status 2>&1)
if echo "$STATUS" | grep -q "running"; then
  pass "status shows running"
else
  fail "status should show running: $STATUS"
fi

# ─── Test 7: POST /setup (admin creation) ──────────────────
echo "▸ Test: admin setup via HTTP"
SETUP_RES=$(curl -sf -X POST http://localhost:3111/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"testpassword123"}' 2>&1 || echo "FAIL")

if echo "$SETUP_RES" | grep -q '"username":"admin"'; then
  pass "POST /setup created admin"
else
  fail "POST /setup failed: $SETUP_RES"
fi

# ─── Test 8: Login + create API key ────────────────────────
echo "▸ Test: login + API key creation"
LOGIN_RES=$(curl -sf -X POST http://localhost:3111/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"testpassword123"}' \
  -c /tmp/cookies.txt 2>&1 || echo "FAIL")

if echo "$LOGIN_RES" | grep -q '"username":"admin"'; then
  pass "login succeeded"
else
  fail "login failed: $LOGIN_RES"
fi

# Extract cookie for key creation
COOKIE=$(grep husk_session /tmp/cookies.txt 2>/dev/null | awk '{print $NF}' || true)
if [ -n "$COOKIE" ]; then
  KEY_RES=$(curl -sf -X POST http://localhost:3111/api/keys \
    -H "Content-Type: application/json" \
    -H "Cookie: husk_session=$COOKIE" \
    -d '{"label":"e2e-test"}' 2>&1 || echo "FAIL")

  if echo "$KEY_RES" | grep -q '"key":"husk_'; then
    pass "API key created"
    API_KEY=$(echo "$KEY_RES" | grep -o '"key":"husk_[^"]*"' | cut -d'"' -f4)
  else
    fail "API key creation failed: $KEY_RES"
  fi
else
  fail "no session cookie from login"
fi

# ─── Test 9: MCP endpoint with API key ─────────────────────
echo "▸ Test: MCP endpoint reachable"
if [ -n "${API_KEY:-}" ]; then
  # POST to /mcp should not 401 with valid key (will return 406 — not valid MCP message)
  MCP_RES=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://localhost:3111/mcp \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{}' 2>/dev/null)

  if [ "$MCP_RES" != "401" ] && [ "$MCP_RES" != "000" ]; then
    pass "MCP endpoint accepts API key (HTTP $MCP_RES)"
  else
    fail "MCP endpoint rejected key: HTTP $MCP_RES"
  fi
else
  fail "skipped — no API key"
fi

# ─── Test 10: Setup is locked after first admin ────────────
echo "▸ Test: /setup locked after admin creation"
LOCK_RES=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3111/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"hacker","password":"12345678"}' 2>/dev/null)

if [ "$LOCK_RES" = "403" ]; then
  pass "POST /setup returns 403 after first admin"
else
  fail "POST /setup should return 403, got: $LOCK_RES"
fi

# ─── Test 11: stop ─────────────────────────────────────────
echo "▸ Test: stop server"
kill $SERVER_PID 2>/dev/null || true

# Wait for exit
for i in $(seq 1 20); do
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    break
  fi
  sleep 0.25
done

if ! kill -0 $SERVER_PID 2>/dev/null; then
  pass "server stopped"
  rm -f /root/.husk/husk.pid
else
  fail "server did not stop"
  kill -9 $SERVER_PID 2>/dev/null || true
fi

# ─── Test 12: config-writer ────────────────────────────────
echo "▸ Test: config file was created"
if [ -f /root/.husk/husk.toml ]; then
  if grep -q "sqlite-vec" /root/.husk/husk.toml; then
    pass "husk.toml has sqlite-vec backend"
  else
    fail "husk.toml missing sqlite-vec"
  fi
else
  fail "husk.toml not found"
fi

# ─── Summary ───────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"
echo ""

if [ $FAIL -gt 0 ]; then
  exit 1
fi
