# YAMS 🍠

**Your AI Memory System** — nutritious context for your AI

Self-hosted memory layer for AI coding assistants. Captures what you work on, remembers cross-project patterns, and surfaces relevant context — across all your machines and tools.

---

## How it works

```
┌──────────────────────────────────────────────────────────────┐
│                        YAMS Server                           │
│                                                              │
│   POST /ingest  ← hooks (shell scripts, any client)         │
│   POST /mcp     ← MCP tools (Claude Code, Cursor, etc.)     │
│   GET  /api/*   ← management REST API                       │
│   GET  /        ← React management UI                       │
│                                                              │
│   SQLite  →  users, machine keys, session metadata          │
│   Qdrant  →  vector embeddings                              │
└──────────────────────────────────────────────────────────────┘
          ↑                          ↑
  Claude Code plugin           Cursor plugin (future)
  hooks  → POST /ingest        extension → POST /ingest
  MCP    → /mcp                REST → /api/search
```

The server is **client-agnostic**. `/ingest` is a universal write endpoint — any tool that can run a shell script or make an HTTP call can send memories. The plugin decides how it captures and retrieves, the server just stores.

---

## Memory scopes

| Scope | What | Example |
|---|---|---|
| `session` | Single session | "Fixed auth bug by resetting cookie domain" |
| `project` | Per-repo knowledge | "This repo uses Zod, never Joi" |
| `global` | Cross-project patterns | "Prefer TanStack Query for server state" |

Projects are keyed by **git remote URL** — works across machines regardless of where the repo is checked out.

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Bun |
| HTTP framework | Hono |
| Database | `bun:sqlite` (auth/keys) + Qdrant (vectors) |
| MCP | `@modelcontextprotocol/sdk` |
| Password hashing | argon2 |
| JWT | jose |
| Linting / formatting | Biome |
| Server tests | `bun test` |
| UI framework | Vite + React |
| UI tests | Vitest |
| Deployment | Docker Compose |

---

## Embeddings

Configurable per project — balance quality vs privacy:

| Provider | When to use |
|---|---|
| Qdrant FastEmbed | Default, fully local, no API key needed |
| Voyage AI `voyage-code-3` | Best quality for code, requires API key |
| Ollama | Self-hosted GPU, sensitive projects |

---

## Auth

- **First launch**: visit `/setup`, create admin username + password
- **Web UI**: username/password → JWT session cookie
- **Machine keys**: `yams_<random>` per device, stored as sha256 hash, with label + expiry + last-used tracking
- **Hooks + MCP**: `Authorization: Bearer <machine_key>`

---

## Project structure

```
YAMS/
  server/
    src/
      index.ts          ← entry, first-launch detection
      app.ts            ← Hono app, route registration
      mcp.ts            ← MCP server + tools
      ingest.ts         ← POST /ingest handler
      auth.ts           ← login, JWT, machine key CRUD
      db.ts             ← SQLite schema + queries (bun:sqlite)
      qdrant.ts         ← Qdrant client wrapper
      embeddings.ts     ← pluggable providers (Voyage/FastEmbed/Ollama)
      setup.ts          ← first-run wizard endpoint
    ui/                 ← Vite + React (built → served by Hono)
    biome.json
    bunfig.toml
  plugins/
    claude-code/
      .claude-plugin/
        plugin.json
      hooks/
        hooks.json
        session-end.sh
      skills/
        yams-init/SKILL.md
        yams-remember/SKILL.md
        yams-search/SKILL.md
      .mcp.json
    cursor/             ← future
  docker-compose.yml
  README.md
  PLAN.md
```
