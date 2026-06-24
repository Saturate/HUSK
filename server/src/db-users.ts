import { getDb } from "./db.js";

// --- Users ---

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

export function getUserCount(): number {
	const row = getDb().query<{ count: number }, []>("SELECT COUNT(*) as count FROM users").get();
	return row?.count ?? 0;
}

export function getUserByUsername(username: string) {
	return getDb().query<UserRow, [string]>("SELECT * FROM users WHERE username = ?").get(username);
}

export function getUserById(id: string) {
	return getDb().query<UserRow, [string]>("SELECT * FROM users WHERE id = ?").get(id);
}

export function getUserByOAuth(provider: string, oauthId: string) {
	return getDb()
		.query<UserRow, [string, string]>(
			"SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?",
		)
		.get(provider, oauthId);
}

export function listUsers() {
	return getDb().query<UserRow, []>("SELECT * FROM users ORDER BY created_at ASC").all();
}

export function createUser(
	username: string,
	passwordHash: string | null,
	opts?: { role?: string; oauthProvider?: string; oauthId?: string; avatarUrl?: string },
): string {
	const id = crypto.randomUUID();
	getDb()
		.query(
			"INSERT INTO users (id, username, password_hash, role, oauth_provider, oauth_id, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
		)
		.run(
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
	const db = getDb();
	const txn = db.transaction(() => {
		db.query(
			"DELETE FROM observations WHERE session_id IN (SELECT id FROM sessions WHERE api_key_id IN (SELECT id FROM api_keys WHERE user_id = ?))",
		).run(id);
		db.query(
			"DELETE FROM sessions WHERE api_key_id IN (SELECT id FROM api_keys WHERE user_id = ?)",
		).run(id);
		db.query(
			"DELETE FROM memories WHERE api_key_id IN (SELECT id FROM api_keys WHERE user_id = ?)",
		).run(id);
		db.query("DELETE FROM api_keys WHERE user_id = ?").run(id);
		db.query("DELETE FROM invites WHERE created_by = ?").run(id);
		db.query(
			"DELETE FROM workspace_projects WHERE workspace_id IN (SELECT id FROM workspaces WHERE created_by = ?)",
		).run(id);
		db.query("DELETE FROM workspaces WHERE created_by = ?").run(id);
		db.query("DELETE FROM user_settings WHERE user_id = ?").run(id);
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
	getDb()
		.query(
			"INSERT INTO api_keys (id, user_id, label, key_hash, key_prefix, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.run(id, params.userId, params.label, params.keyHash, params.keyPrefix, params.expiresAt);
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
	return getDb().query<ApiKeyRow, [string]>("SELECT * FROM api_keys WHERE key_hash = ?").get(hash);
}

export function getApiKeyById(id: string) {
	return getDb().query<ApiKeyRow, [string]>("SELECT * FROM api_keys WHERE id = ?").get(id);
}

export function listApiKeys(userId?: string) {
	if (userId) {
		return getDb()
			.query<Omit<ApiKeyRow, "key_hash">, [string]>(
				"SELECT id, user_id, label, key_prefix, is_active, expires_at, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
			)
			.all(userId);
	}
	return getDb()
		.query<Omit<ApiKeyRow, "key_hash">, []>(
			"SELECT id, user_id, label, key_prefix, is_active, expires_at, created_at, last_used_at FROM api_keys ORDER BY created_at DESC",
		)
		.all();
}

export function revokeApiKey(id: string): boolean {
	const result = getDb().query("UPDATE api_keys SET is_active = 0 WHERE id = ?").run(id);
	return result.changes > 0;
}

export function updateKeyLastUsed(id: string) {
	getDb().query("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(id);
}
