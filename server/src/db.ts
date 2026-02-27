import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let db: Database;

export function getDb(): Database {
	return db;
}

export function initDb(path?: string): Database {
	const dbPath = path ?? process.env.YAMS_DB_PATH ?? "data/yams.db";

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
	// Migration: add role column if missing (existing DBs)
	const userCols = db.query<{ name: string }, []>("PRAGMA table_info(users)").all();
	const colNames = new Set(userCols.map((c) => c.name));
	if (!colNames.has("role")) {
		db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
		// All existing users predate roles, promote them to admin
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

	return db;
}

// --- Users ---

export function getUserCount(): number {
	const row = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM users").get();
	return row?.count ?? 0;
}

export interface UserRow {
	id: string;
	username: string;
	password_hash: string | null;
	role: string;
	oauth_provider: string | null;
	oauth_id: string | null;
	avatar_url: string | null;
	created_at: string;
}

export function getUserByUsername(username: string) {
	return db
		.query<UserRow, [string]>("SELECT * FROM users WHERE username = ?")
		.get(username);
}

export function getUserById(id: string) {
	return db.query<UserRow, [string]>("SELECT * FROM users WHERE id = ?").get(id);
}

export function getUserByOAuth(provider: string, oauthId: string) {
	return db
		.query<UserRow, [string, string]>(
			"SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?",
		)
		.get(provider, oauthId);
}

export function listUsers() {
	return db
		.query<UserRow, []>("SELECT * FROM users ORDER BY created_at ASC")
		.all();
}

export function createUser(
	username: string,
	passwordHash: string | null,
	opts?: { role?: string; oauthProvider?: string; oauthId?: string; avatarUrl?: string },
): string {
	const id = crypto.randomUUID();
	db.query(
		"INSERT INTO users (id, username, password_hash, role, oauth_provider, oauth_id, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
	).run(
		id,
		username,
		passwordHash,
		opts?.role ?? "user",
		opts?.oauthProvider ?? null,
		opts?.oauthId ?? null,
		opts?.avatarUrl ?? null,
	);
	return id;
}

export function deleteUser(id: string): boolean {
	const txn = db.transaction(() => {
		// Delete memories owned by this user's API keys
		db.query(
			"DELETE FROM memories WHERE api_key_id IN (SELECT id FROM api_keys WHERE user_id = ?)",
		).run(id);
		// Delete the user's API keys
		db.query("DELETE FROM api_keys WHERE user_id = ?").run(id);
		// Delete invites created by this user
		db.query("DELETE FROM invites WHERE created_by = ?").run(id);
		// Delete the user
		const result = db.query("DELETE FROM users WHERE id = ?").run(id);
		return result.changes > 0;
	});
	return txn();
}

// --- API Keys ---

export function createApiKey(params: {
	userId: string;
	label: string;
	keyHash: string;
	keyPrefix: string;
	expiresAt: string | null;
}): string {
	const id = crypto.randomUUID();
	db.query(
		"INSERT INTO api_keys (id, user_id, label, key_hash, key_prefix, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
	).run(id, params.userId, params.label, params.keyHash, params.keyPrefix, params.expiresAt);
	return id;
}

interface ApiKeyRow {
	id: string;
	user_id: string;
	label: string;
	key_hash: string;
	key_prefix: string;
	is_active: number;
	expires_at: string | null;
	created_at: string;
	last_used_at: string | null;
}

export function getApiKeyByHash(hash: string) {
	return db.query<ApiKeyRow, [string]>("SELECT * FROM api_keys WHERE key_hash = ?").get(hash);
}

export function getApiKeyById(id: string) {
	return db.query<ApiKeyRow, [string]>("SELECT * FROM api_keys WHERE id = ?").get(id);
}

export function listApiKeys(userId?: string) {
	if (userId) {
		return db
			.query<Omit<ApiKeyRow, "key_hash">, [string]>(
				"SELECT id, user_id, label, key_prefix, is_active, expires_at, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
			)
			.all(userId);
	}
	return db
		.query<Omit<ApiKeyRow, "key_hash">, []>(
			"SELECT id, user_id, label, key_prefix, is_active, expires_at, created_at, last_used_at FROM api_keys ORDER BY created_at DESC",
		)
		.all();
}

export function revokeApiKey(id: string): boolean {
	const result = db.query("UPDATE api_keys SET is_active = 0 WHERE id = ?").run(id);
	return result.changes > 0;
}

export function updateKeyLastUsed(id: string) {
	db.query("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(id);
}

// --- Memories ---

export interface MemoryRow {
	id: string;
	api_key_id: string;
	git_remote: string | null;
	scope: string;
	summary: string;
	metadata: string | null;
	created_at: string;
}

export function createMemory(params: {
	id: string;
	apiKeyId: string;
	gitRemote?: string | null;
	scope: string;
	summary: string;
	metadata?: string | null;
}): string {
	db.query(
		"INSERT INTO memories (id, api_key_id, git_remote, scope, summary, metadata) VALUES (?, ?, ?, ?, ?, ?)",
	).run(
		params.id,
		params.apiKeyId,
		params.gitRemote ?? null,
		params.scope,
		params.summary,
		params.metadata ?? null,
	);
	return params.id;
}

export function getMemory(id: string): MemoryRow | undefined {
	return db.query<MemoryRow, [string]>("SELECT * FROM memories WHERE id = ?").get(id) ?? undefined;
}

export function listMemories(opts?: {
	gitRemote?: string;
	scope?: string;
	limit?: number;
	offset?: number;
	userId?: string;
}): MemoryRow[] {
	const conditions: string[] = [];
	const params: (string | number)[] = [];

	if (opts?.gitRemote) {
		conditions.push("m.git_remote = ?");
		params.push(opts.gitRemote);
	}
	if (opts?.scope) {
		conditions.push("m.scope = ?");
		params.push(opts.scope);
	}
	if (opts?.userId) {
		conditions.push("ak.user_id = ?");
		params.push(opts.userId);
	}

	const needsJoin = opts?.userId != null;
	let sql = needsJoin
		? "SELECT m.* FROM memories m JOIN api_keys ak ON m.api_key_id = ak.id"
		: "SELECT * FROM memories m";

	if (conditions.length > 0) {
		sql += ` WHERE ${conditions.join(" AND ")}`;
	}
	sql += " ORDER BY m.created_at DESC";

	const limit = opts?.limit ?? 100;
	const offset = opts?.offset ?? 0;
	sql += " LIMIT ? OFFSET ?";
	params.push(limit, offset);

	return db.query<MemoryRow, (string | number)[]>(sql).all(...params);
}

export function deleteMemory(id: string): boolean {
	const result = db.query("DELETE FROM memories WHERE id = ?").run(id);
	return result.changes > 0;
}

export function listDistinctGitRemotes(userId?: string): string[] {
	if (userId) {
		const rows = db
			.query<{ git_remote: string }, [string]>(
				"SELECT DISTINCT m.git_remote FROM memories m JOIN api_keys ak ON m.api_key_id = ak.id WHERE m.git_remote IS NOT NULL AND ak.user_id = ? ORDER BY m.git_remote",
			)
			.all(userId);
		return rows.map((r) => r.git_remote);
	}
	const rows = db
		.query<{ git_remote: string }, []>(
			"SELECT DISTINCT git_remote FROM memories WHERE git_remote IS NOT NULL ORDER BY git_remote",
		)
		.all();
	return rows.map((r) => r.git_remote);
}

export function listDistinctScopes(userId?: string): string[] {
	if (userId) {
		const rows = db
			.query<{ scope: string }, [string]>(
				"SELECT DISTINCT m.scope FROM memories m JOIN api_keys ak ON m.api_key_id = ak.id WHERE ak.user_id = ? ORDER BY m.scope",
			)
			.all(userId);
		return rows.map((r) => r.scope);
	}
	const rows = db
		.query<{ scope: string }, []>("SELECT DISTINCT scope FROM memories ORDER BY scope")
		.all();
	return rows.map((r) => r.scope);
}

export function countMemories(opts?: {
	gitRemote?: string;
	scope?: string;
	userId?: string;
}): number {
	const conditions: string[] = [];
	const params: string[] = [];

	if (opts?.gitRemote) {
		conditions.push("m.git_remote = ?");
		params.push(opts.gitRemote);
	}
	if (opts?.scope) {
		conditions.push("m.scope = ?");
		params.push(opts.scope);
	}
	if (opts?.userId) {
		conditions.push("ak.user_id = ?");
		params.push(opts.userId);
	}

	const needsJoin = opts?.userId != null;
	let sql = needsJoin
		? "SELECT COUNT(*) as count FROM memories m JOIN api_keys ak ON m.api_key_id = ak.id"
		: "SELECT COUNT(*) as count FROM memories m";

	if (conditions.length > 0) {
		sql += ` WHERE ${conditions.join(" AND ")}`;
	}

	const row = db.query<{ count: number }, string[]>(sql).get(...params);
	return row?.count ?? 0;
}

// --- Invites ---

export interface InviteRow {
	id: string;
	email: string;
	token: string;
	role: string;
	created_by: string;
	created_at: string;
	expires_at: string;
	used_at: string | null;
}

export function createInvite(params: {
	email: string;
	role: string;
	createdBy: string;
	expiresAt: string;
}): { id: string; token: string } {
	const id = crypto.randomUUID();
	const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
	db.query(
		"INSERT INTO invites (id, email, token, role, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
	).run(id, params.email, token, params.role, params.createdBy, params.expiresAt);
	return { id, token };
}

export function getInviteByToken(token: string) {
	return db
		.query<InviteRow, [string]>("SELECT * FROM invites WHERE token = ?")
		.get(token);
}

export function listInvites() {
	return db
		.query<InviteRow, []>("SELECT * FROM invites ORDER BY created_at DESC")
		.all();
}

export function deleteInvite(id: string): boolean {
	const result = db.query("DELETE FROM invites WHERE id = ?").run(id);
	return result.changes > 0;
}

export function markInviteUsed(id: string) {
	db.query("UPDATE invites SET used_at = datetime('now') WHERE id = ?").run(id);
}

// --- JWT Secret ---

export function getOrCreateJwtSecret(): string {
	const envSecret = process.env.YAMS_JWT_SECRET;
	if (envSecret) return envSecret;

	const row = db
		.query<{ value: string }, [string]>("SELECT value FROM config WHERE key = ?")
		.get("jwt_secret");

	if (row) return row.value;

	const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
	db.query("INSERT INTO config (key, value) VALUES (?, ?)").run("jwt_secret", secret);
	return secret;
}
