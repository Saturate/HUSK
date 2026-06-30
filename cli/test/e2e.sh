#!/usr/bin/env bash
set -euo pipefail
MODE="${1:-local}"
PASS=0; FAIL=0; ERRORS=""
ADMIN_PASSWORD="${HUSK_PASSWORD:-husk-e2e-admin}"

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); ERRORS="${ERRORS}\n  FAIL: $1"; echo "  FAIL: $1"; }
check() { if "$@" 2>&1 | grep -q "$1"; then pass "$2"; else fail "$2"; fi; }
check_output() { local n="$1" e="$2"; shift 2; if "$@" 2>&1 | grep -q "$e"; then pass "$n"; else fail "$n"; fi; }

echo ""; echo "=== HUSK E2E Test (${MODE}) ==="

if [ "$MODE" = "local" ]; then
  echo ""; echo "--- CLI ---"
  check_output "version" "0\." husk -v
  check_output "help" "Commands:" husk --help
  check_output "status" "Status:" husk status
  check_output "sync dry-run" "memories" husk sync --dry-run

  echo ""; echo "--- Server start ---"
  husk --foreground > /tmp/husk-e2e.log 2>&1 &
  HUSK_PID=$!
  echo "  Waiting for server..."
  for _ in $(seq 1 60); do curl -sf http://localhost:3000/health > /dev/null 2>&1 && break; sleep 3; done
  check_output "health" '"status":"ok"' curl -s http://localhost:3000/health
  API_KEY=$(grep -o 'husk_[A-Za-z0-9_-]*' /tmp/husk-e2e.log | head -1 || true)
  HUSK_URL="http://localhost:3000"
  ADMIN_PASSWORD="husk-e2e-admin"
  if [ -z "$API_KEY" ]; then fail "API key"; kill "$HUSK_PID" 2>/dev/null || true; echo "Results: $PASS passed, $FAIL failed"; exit 1; fi
  pass "API key generated"

elif [ "$MODE" = "remote" ]; then
  HUSK_URL="${HUSK_URL:?Set HUSK_URL}"; API_KEY="${HUSK_API_KEY:?Set HUSK_API_KEY}"
  echo ""; echo "--- Remote: ${HUSK_URL} ---"
  check_output "health" '"status":"ok"' curl -s "${HUSK_URL}/health"
fi

echo ""; echo "--- Auth ---"
curl -s -c /tmp/husk-cookies -X POST "${HUSK_URL}/api/auth/login" -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"${ADMIN_PASSWORD}\"}" > /tmp/husk-login.json
if grep -q '"username"' /tmp/husk-login.json; then pass "admin login"; else fail "admin login"; fi

echo ""; echo "--- Ingest ---"
check_output "ingest fact" '"id"\|"duplicate"' curl -s -X POST "${HUSK_URL}/ingest" -H "Authorization: Bearer ${API_KEY}" -H "Content-Type: application/json" -d '{"summary":"E2E: sqlite-vec zero-dep vector storage","scope":"project","git_remote":"e2e-test","title":"sqlite-vec","memory_type":"fact"}'
check_output "ingest decision" '"id"\|"duplicate"' curl -s -X POST "${HUSK_URL}/ingest" -H "Authorization: Bearer ${API_KEY}" -H "Content-Type: application/json" -d '{"summary":"E2E: chose Qdrant over Pinecone","scope":"project","git_remote":"e2e-test","title":"Qdrant","memory_type":"decision"}'

echo ""; echo "--- Admin API ---"
check_output "knowledge tree" "workspaces" curl -s -b /tmp/husk-cookies "${HUSK_URL}/api/admin/knowledge/tree"
check_output "memories list" "memories" curl -s -b /tmp/husk-cookies "${HUSK_URL}/api/admin/memories"
check_output "filters" "projects" curl -s -b /tmp/husk-cookies "${HUSK_URL}/api/admin/filters"
check_output "settings" "settings" curl -s -b /tmp/husk-cookies "${HUSK_URL}/api/admin/settings"
check_output "stats" "memories" curl -s -b /tmp/husk-cookies "${HUSK_URL}/api/admin/stats"

echo ""; echo "--- MCP ---"
check_output "tools/list" "tools" curl -s -X POST "${HUSK_URL}/mcp" -H "Authorization: Bearer ${API_KEY}" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

echo ""; echo "--- OTLP ---"
OTLP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${HUSK_URL}/v1/logs" -H "Content-Type: application/json" -d '{}')
if [ "$OTLP" = "200" ]; then pass "OTLP logs"; else fail "OTLP: HTTP $OTLP"; fi

echo ""; echo "--- UI ---"
for r in "/" "/dashboard" "/knowledge" "/settings" "/admin-settings"; do
  S=$(curl -s -o /dev/null -w "%{http_code}" "${HUSK_URL}${r}")
  if [ "$S" = "200" ]; then pass "UI ${r}"; else fail "UI ${r}: HTTP $S"; fi
done

echo ""; echo "--- Graph + Telemetry ---"
check_output "graph" "nodes" curl -s -b /tmp/husk-cookies "${HUSK_URL}/api/graph"
check_output "telemetry" "today" curl -s -b /tmp/husk-cookies "${HUSK_URL}/telemetry/stats/overview"

if [ "$MODE" = "local" ] && [ -n "${HUSK_PID:-}" ]; then kill "$HUSK_PID" 2>/dev/null || true; wait "$HUSK_PID" 2>/dev/null || true; fi

echo ""; echo "==============================="
echo "Results: $PASS passed, $FAIL failed"
if [ -n "$ERRORS" ]; then echo -e "\nFailures:$ERRORS"; fi
echo "==============================="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
