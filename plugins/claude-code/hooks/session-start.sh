#!/bin/bash
# HUSK session-start hook — ensures HUSK server is reachable
# Falls back to starting it via the CLI if the OS service isn't running

set -euo pipefail

# Bail if HUSK isn't configured
[ -z "${HUSK_URL:-}" ] && exit 0

# Check if server is reachable
if curl -sf "${HUSK_URL}/health" > /dev/null 2>&1; then
	exit 0
fi

# Try to start it — npx husk will no-op if already running
if command -v npx > /dev/null 2>&1; then
	npx husk 2>/dev/null &
fi
