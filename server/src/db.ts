import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let db: Database;

export function getDb(): Database {
	return db;
}

export function initDb(path?: string): Database {
	const dbPath = path ?? "data/yams.db";

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
			password_hash TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);

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
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id),
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			expires_at TEXT NOT NULL
		)
	`);

	return db;
}

// --- Users ---

export function getUserCount(): number {
	const row = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM users").get();
	return row?.count ?? 0;
}

export function getUserByUsername(username: string) {
	return db
		.query<{ id: string; username: string; password_hash: string; created_at: string }, [string]>(
			"SELECT id, username, password_hash, created_at FROM users WHERE username = ?",
		)
		.get(username);
}

export function createUser(username: string, passwordHash: string): string {
	const id = crypto.randomUUID();
	db.query("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)").run(
		id,
		username,
		passwordHash,
	);
	return id;
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

export function listApiKeys() {
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
