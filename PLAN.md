# YAMS — Build Plan

## Phase 1: Project scaffold + auth foundation

Set up the monorepo, get Bun + Hono running, SQLite schema, first-launch setup flow, and machine key auth. No Qdrant yet — just a working server you can start and log into.

### Tasks

1. Init Bun workspace with `server/` and `plugins/` packages
2. Add Biome config (strict TypeScript, formatting)
3. `db.ts` — SQLite schema via `bun:sqlite`:
   ```sql
   CREATE TABLE users (
     id            TEXT PRIMARY KEY,
     username      TEXT UNIQUE NOT NULL,
     password_hash TEXT NOT NULL,
     created_at    INTEGER NOT NULL
   );

   CREATE TABLE api_keys (
     id           TEXT PRIMARY KEY,
     key_hash     TEXT UNIQUE NOT NULL,
     label        TEXT NOT NULL,
     created_at   INTEGER NOT NULL,
     expires_at   INTEGER,
     last_used_at INTEGER,
     is_active    INTEGER DEFAULT 1
   );

   CREATE TABLE sessions (
     id          TEXT PRIMARY KEY,
     key_id      TEXT NOT NULL REFERENCES api_keys(id),
     git_remote  TEXT,
     scope       TEXT NOT NULL DEFAULT 'session',
     summary     TEXT,
     created_at  INTEGER NOT NULL
   );
   ```
4. `setup.ts` — `GET /setup` serves a minimal HTML form, `POST /setup` creates admin user (argon2 hash). Only works when no users exist. All other routes return 503 until setup is done.
5. `auth.ts`:
   - `POST /api/auth/login` — username + password → JWT (jose)
   - JWT middleware for `/api/*` routes
   - Bearer middleware for `/ingest` and `/mcp` — validates machine key, updates `last_used_at`
6. `POST /api/keys` — create machine key (admin JWT required), returns `yams_<random>` once
7. `GET /api/keys` — list keys with label, created, expires, last_used (admin only)
8. `DELETE /api/keys/:id` — revoke key (admin only)
9. `GET /api/keys/me` — info about the calling key (any valid key)
10. Tests for auth flow, key CRUD, expiry checking, first-launch lock

### Done when
- `bun run dev` starts server
- Visit `/setup`, create admin, login via API, create/list/revoke machine keys
- Biome passes, tests pass

---

## Phase 2: Qdrant + embeddings + ingest

Connect Qdrant, implement pluggable embeddings, build the ingest pipeline. After this, hooks can POST session data and it gets stored as vectors.

### Tasks

1. `docker-compose.yml` — Qdrant service (internal only, not port-exposed to host)
2. `qdrant.ts` — client wrapper using `@qdrant/js-client-rest`, collection creation on startup
3. `embeddings.ts` — provider interface:
   ```typescript
   interface EmbeddingProvider {
     embed(text: string): Promise<number[]>;
     dimensions: number;
   }
   ```
   Implementations: Qdrant FastEmbed (default), Voyage AI (`voyage-code-3`), Ollama
4. Embedding config — server-level default, per-project override stored in SQLite
5. `ingest.ts` — `POST /ingest` handler:
   - Validates bearer key
   - Accepts: `{ git_remote, summary, scope, metadata? }`
   - Generates embedding from summary
   - Upserts into Qdrant with payload: machine label, git_remote, scope, timestamp
6. Session metadata stored in SQLite (for the UI to list sessions without hitting Qdrant)
7. Tests: ingest pipeline end-to-end, embedding provider switching

### Done when
- `curl POST /ingest` with a machine key stores a vector in Qdrant
- Embedding provider is configurable
- Docker compose brings up both YAMS + Qdrant

---

## Phase 3: MCP server

Add the MCP tools so Claude Code (and other MCP clients) can retrieve memories.

### Tasks

1. `mcp.ts` — MCP server using `@modelcontextprotocol/sdk` with Streamable HTTP transport on `/mcp`
2. MCP tool: `search` — vector similarity search, filters by scope/project/machine
   ```
   Input:  { query: string, scope?: string, project?: string, limit?: number }
   Output: ranked list of memories with scores
   ```
3. MCP tool: `remember` — store a memory on demand (wraps the ingest logic)
   ```
   Input:  { content: string, scope: "session" | "project" | "global", project?: string }
   ```
4. MCP tool: `list_projects` — list known projects (distinct git remotes)
5. Auth: MCP requests validated via same bearer key middleware
6. Tests: MCP tool calls end-to-end

### Done when
- Claude Code can connect via `.mcp.json` and call search/remember tools
- Results come back filtered by scope and project

---

## Phase 4: Claude Code plugin

Package everything as a Claude Code plugin that users can install.

### Tasks

1. `plugins/claude-code/.claude-plugin/plugin.json` — name, description, version, author
2. `hooks/hooks.json` — register `SessionEnd` event
3. `hooks/session-end.sh`:
   ```bash
   #!/bin/bash
   SESSION_JSON=$(cat)
   curl -s -X POST "${YAMS_URL}/ingest" \
     -H "Authorization: Bearer ${YAMS_KEY}" \
     -H "Content-Type: application/json" \
     -d "$SESSION_JSON"
   ```
4. `.mcp.json` — YAMS MCP server config with env var references
5. `skills/yams-init/SKILL.md` — first-time setup: ask for server URL, admin key, create machine key, write env vars to shell profile
6. `skills/yams-remember/SKILL.md` — manually save a memory with scope
7. `skills/yams-search/SKILL.md` — explicitly search memories
8. Test: install plugin locally, verify hooks fire and MCP connects

### Done when
- `/yams-init` creates a machine key and configures the local machine
- Session end auto-captures to the server
- `/yams-search` returns relevant memories

---

## Phase 5: Management UI

React app for browsing memories, managing keys, and configuring projects.

### Tasks

1. Scaffold Vite + React app in `server/ui/`
2. Vitest + testing-library setup for component tests
3. Login page → JWT stored in httpOnly cookie
4. Dashboard: recent sessions, memory count by scope, key usage
5. Keys page: list machine keys with last_used, expiry, create/revoke
6. Memory browser: search memories, filter by project/scope, view/delete individual entries
7. Project settings: per-project embedding provider config
8. Build output served as static files by Hono (no separate process)

### Done when
- Admin can log in, manage keys, browse memories, configure projects via the UI
- UI is served from the same Docker container

---

## Phase 6: Docker + deployment

Production Docker setup.

### Tasks

1. Multi-stage Dockerfile: `bun install` → `bun build` (UI) → slim runtime image
2. `docker-compose.yml` with YAMS + Qdrant, persistent volumes for SQLite + Qdrant data
3. Health check endpoint (`GET /health`)
4. Optional: Ollama service for local embeddings
5. `.env.example` with documented vars

### Done when
- `docker compose up` brings up YAMS end-to-end on a fresh machine
- Data persists across restarts

---

## Open questions

- **SessionEnd hook payload**: what data does Claude Code actually pass to SessionEnd hooks? Need to verify the schema to know what we can capture automatically.
- **Cross-project retrieval**: when to surface global memories? On SessionStart, or only when explicitly searched?
- **Memory deduplication**: if the same insight is captured across sessions, how to avoid noise? Similarity threshold on ingest?
- **Retention policy**: auto-expire session-scoped memories after N days? Configurable?
