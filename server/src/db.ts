import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let db: Database;

export function getDb(): Database {
	return db;
}

export function initDb(path?: string): Database {
	const dbPath = path ?? process.env.HUSK_DB_PATH ?? "data/husk.db";

	if (dbPath !== ":memory:") {
		mkdirSync(dirname(dbPath), { recursive: true });
	}

	db = new Database(dbPath);
	db.run("PRAGMA journal_mode = WAL");
	db.run("PRAGMA foreign_keys = ON");

	db.run(`
		CREATE TABLE IF NOT EXISTS config (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT,
			role TEXT NOT NULL DEFAULT 'user',
			oauth_provider TEXT,
			oauth_id TEXT,
			avatar_url TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);
	const userCols = db
		.query<{ name: string; notnull: number }, []>("PRAGMA table_info(users)")
		.all();
	const colNames = new Set(userCols.map((c) => c.name));
	if (!colNames.has("role")) {
		db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
		db.run("UPDATE users SET role = 'admin'");
	}
	if (!colNames.has("oauth_provider")) {
		db.run("ALTER TABLE users ADD COLUMN oauth_provider TEXT");
		db.run("ALTER TABLE users ADD COLUMN oauth_id TEXT");
		db.run("ALTER TABLE users ADD COLUMN avatar_url TEXT");
	}
	db.run(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_id) WHERE oauth_provider IS NOT NULL",
	);
	const pwCol = userCols.find((c) => c.name === "password_hash");
	if (pwCol?.notnull) {
		db.run("PRAGMA foreign_keys = OFF");
		db.run("BEGIN");
		db.run("DROP TABLE IF EXISTS users_new");
		db.run(`
			CREATE TABLE users_new (
				id TEXT PRIMARY KEY,
				username TEXT UNIQUE NOT NULL,
				password_hash TEXT,
				role TEXT NOT NULL DEFAULT 'user',
				oauth_provider TEXT,
				oauth_id TEXT,
				avatar_url TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			)
		`);
		db.run(
			"INSERT INTO users_new SELECT id, username, password_hash, role, oauth_provider, oauth_id, avatar_url, created_at FROM users",
		);
		db.run("DROP TABLE users");
		db.run("ALTER TABLE users_new RENAME TO users");
		db.run(
			"CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_id) WHERE oauth_provider IS NOT NULL",
		);
		db.run("COMMIT");
		db.run("PRAGMA foreign_keys = ON");
		db.run("PRAGMA foreign_key_check");
	}

	db.run(`
		CREATE TABLE IF NOT EXISTS api_keys (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id),
			label TEXT NOT NULL,
			key_hash TEXT UNIQUE NOT NULL,
			key_prefix TEXT NOT NULL,
			is_active INTEGER NOT NULL DEFAULT 1,
			expires_at TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			last_used_at TEXT
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS memories (
			id TEXT PRIMARY KEY,
			api_key_id TEXT NOT NULL REFERENCES api_keys(id),
			git_remote TEXT,
			scope TEXT NOT NULL DEFAULT 'session',
			summary TEXT NOT NULL,
			metadata TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);
	db.run("CREATE INDEX IF NOT EXISTS idx_memories_git_remote ON memories(git_remote)");
	db.run("CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope)");

	const memCols = db.query<{ name: string }, []>("PRAGMA table_info(memories)").all();
	if (!memCols.some((c) => c.name === "expires_at")) {
		db.run("ALTER TABLE memories ADD COLUMN expires_at TEXT");
	}
	db.run(
		"CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at) WHERE expires_at IS NOT NULL",
	);

	db.run(`
		CREATE TABLE IF NOT EXISTS invites (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL,
			token TEXT UNIQUE NOT NULL,
			role TEXT NOT NULL DEFAULT 'user',
			created_by TEXT NOT NULL REFERENCES users(id),
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			expires_at TEXT NOT NULL,
			used_at TEXT
		)
	`);
	db.run("CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token)");
	db.run("CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email)");

	db.run(`
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			claude_session_id TEXT NOT NULL,
			api_key_id TEXT NOT NULL REFERENCES api_keys(id),
			project TEXT,
			status TEXT NOT NULL DEFAULT 'active',
			summary TEXT,
			started_at TEXT NOT NULL DEFAULT (datetime('now')),
			ended_at TEXT
		)
	`);
	db.run(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_claude_apikey ON sessions(claude_session_id, api_key_id)",
	);
	db.run("CREATE INDEX IF NOT EXISTS idx_sessions_api_key_id ON sessions(api_key_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)");

	db.run(`
		CREATE TABLE IF NOT EXISTS observations (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL REFERENCES sessions(id),
			event TEXT NOT NULL,
			tool_name TEXT,
			content TEXT NOT NULL,
			compressed INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);
	db.run("CREATE INDEX IF NOT EXISTS idx_observations_session_id ON observations(session_id)");
	db.run(
		"CREATE INDEX IF NOT EXISTS idx_observations_compressed ON observations(compressed) WHERE compressed = 0",
	);

	db.run(`
		CREATE TABLE IF NOT EXISTS workspaces (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			created_by TEXT NOT NULL REFERENCES users(id),
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);
	db.run(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_name_user ON workspaces(name, created_by)",
	);

	db.run(`
		CREATE TABLE IF NOT EXISTS workspace_projects (
			workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
			git_remote TEXT NOT NULL UNIQUE,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (workspace_id, git_remote)
		)
	`);
	db.run(
		"CREATE INDEX IF NOT EXISTS idx_workspace_projects_remote ON workspace_projects(git_remote)",
	);

	if (!memCols.some((c) => c.name === "workspace_id")) {
		db.run(
			"ALTER TABLE memories ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL",
		);
	}
	db.run("CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_id)");

	db.run(`
		CREATE TABLE IF NOT EXISTS user_settings (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			key TEXT NOT NULL,
			value TEXT NOT NULL,
			PRIMARY KEY (user_id, key)
		)
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS graph_edges (
			id TEXT PRIMARY KEY,
			source_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
			target_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
			edge_type TEXT NOT NULL,
			metadata TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			created_by TEXT NOT NULL
		)
	`);
	db.run("CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_memory_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_memory_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(edge_type)");
	db.run(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edges_unique ON graph_edges(source_memory_id, target_memory_id, edge_type)",
	);

	// --- Telemetry tables ---

	db.run(`
		CREATE TABLE IF NOT EXISTS traces (
			id TEXT PRIMARY KEY,
			trace_id TEXT NOT NULL UNIQUE,
			api_key_id TEXT NOT NULL REFERENCES api_keys(id),
			project TEXT,
			git_branch TEXT,
			model TEXT,
			agent_type TEXT,
			status TEXT NOT NULL DEFAULT 'active',
			started_at TEXT NOT NULL DEFAULT (datetime('now')),
			ended_at TEXT,
			total_input_tokens INTEGER DEFAULT 0,
			total_output_tokens INTEGER DEFAULT 0,
			total_cache_read_tokens INTEGER DEFAULT 0,
			total_cache_create_tokens INTEGER DEFAULT 0,
			total_cost_usd REAL DEFAULT 0,
			total_turns INTEGER DEFAULT 0,
			total_tool_calls INTEGER DEFAULT 0,
			total_tool_failures INTEGER DEFAULT 0
		)
	`);
	db.run("CREATE INDEX IF NOT EXISTS idx_traces_api_key ON traces(api_key_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_traces_project ON traces(project)");
	db.run("CREATE INDEX IF NOT EXISTS idx_traces_started ON traces(started_at)");

	db.run(`
		CREATE TABLE IF NOT EXISTS spans (
			id TEXT PRIMARY KEY,
			trace_id TEXT NOT NULL REFERENCES traces(trace_id),
			span_id TEXT NOT NULL,
			parent_span_id TEXT,
			name TEXT NOT NULL,
			kind TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'ok',
			started_at TEXT NOT NULL,
			ended_at TEXT,
			duration_ms INTEGER,
			tool_name TEXT,
			input_summary TEXT,
			exit_code INTEGER,
			output_size INTEGER,
			model TEXT,
			input_tokens INTEGER,
			output_tokens INTEGER,
			cache_read_tokens INTEGER,
			cache_create_tokens INTEGER,
			cost_usd REAL,
			attributes TEXT
		)
	`);
	db.run("CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans(parent_span_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_spans_kind ON spans(kind)");
	db.run(
		"CREATE INDEX IF NOT EXISTS idx_spans_tool ON spans(tool_name) WHERE tool_name IS NOT NULL",
	);
	db.run("CREATE INDEX IF NOT EXISTS idx_spans_started ON spans(started_at)");

	// Migration: add compression tracking to traces
	const traceCols = db.query<{ name: string }, []>("PRAGMA table_info(traces)").all();
	if (!traceCols.some((c) => c.name === "summary")) {
		db.run("ALTER TABLE traces ADD COLUMN summary TEXT");
		db.run("ALTER TABLE traces ADD COLUMN last_compressed_at TEXT");
	}

	// Migration: add linked_trace_id for OTel span links (subagent -> child trace)
	const spanCols = db.query<{ name: string }, []>("PRAGMA table_info(spans)").all();
	if (!spanCols.some((c) => c.name === "linked_trace_id")) {
		db.run("ALTER TABLE spans ADD COLUMN linked_trace_id TEXT");
	}

	db.run(`
		CREATE TABLE IF NOT EXISTS telemetry_metrics (
			id TEXT PRIMARY KEY,
			date TEXT NOT NULL,
			api_key_id TEXT NOT NULL REFERENCES api_keys(id),
			project TEXT,
			model TEXT,
			metric_name TEXT NOT NULL,
			metric_value REAL NOT NULL DEFAULT 0,
			UNIQUE(date, api_key_id, project, model, metric_name)
		)
	`);
	db.run("CREATE INDEX IF NOT EXISTS idx_metrics_date ON telemetry_metrics(date)");
	db.run("CREATE INDEX IF NOT EXISTS idx_metrics_project ON telemetry_metrics(project)");

	// Migration: add enrichment columns to observations
	const obsCols = db.query<{ name: string }, []>("PRAGMA table_info(observations)").all();
	const obsColNames = new Set(obsCols.map((c) => c.name));
	if (!obsColNames.has("prompt")) {
		db.run("ALTER TABLE observations ADD COLUMN prompt TEXT");
		db.run("ALTER TABLE observations ADD COLUMN tool_input_summary TEXT");
		db.run("ALTER TABLE observations ADD COLUMN files_modified TEXT");
	}

	return db;
}

// Re-export everything from split files for backward compatibility
export * from "./db-users.js";
export * from "./db-sessions.js";
export * from "./db-memories.js";
export * from "./db-scope.js";
