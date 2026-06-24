import { getDb } from "./db.js";

// --- Memories ---

export interface MemoryRow {
	id: string;
	api_key_id: string;
	git_remote: string | null;
	scope: string;
	summary: string;
	metadata: string | null;
	created_at: string;
	expires_at: string | null;
	workspace_id: string | null;
}

export function createMemory(params: {
	id: string;
	apiKeyId: string;
	gitRemote?: string | null;
	scope: string;
	summary: string;
	metadata?: string | null;
	expiresAt?: string | null;
	workspaceId?: string | null;
}): string {
	getDb()
		.query(
			"INSERT INTO memories (id, api_key_id, git_remote, scope, summary, metadata, expires_at, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.run(
			params.id,
			params.apiKeyId,
			params.gitRemote ?? null,
			params.scope,
			params.summary,
			params.metadata ?? null,
			params.expiresAt ?? null,
			params.workspaceId ?? null,
		);
	return params.id;
}

const EXPIRY_FILTER = "(m.expires_at IS NULL OR m.expires_at > datetime('now'))";

export function getMemory(id: string): MemoryRow | undefined {
	return (
		getDb()
			.query<MemoryRow, [string]>(`SELECT * FROM memories m WHERE m.id = ? AND ${EXPIRY_FILTER}`)
			.get(id) ?? undefined
	);
}

export function getMemoryForUser(id: string, userId: string): MemoryRow | undefined {
	return (
		getDb()
			.query<MemoryRow, [string, string]>(
				`SELECT m.* FROM memories m JOIN api_keys k ON m.api_key_id = k.id WHERE m.id = ? AND k.user_id = ? AND ${EXPIRY_FILTER}`,
			)
			.get(id, userId) ?? undefined
	);
}

export function listMemories(opts?: {
	gitRemote?: string;
	scope?: string;
	limit?: number;
	offset?: number;
	userId?: string;
}): MemoryRow[] {
	const conditions: string[] = [EXPIRY_FILTER];
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

	sql += ` WHERE ${conditions.join(" AND ")}`;
	sql += " ORDER BY m.created_at DESC";

	const limit = opts?.limit ?? 100;
	const offset = opts?.offset ?? 0;
	sql += " LIMIT ? OFFSET ?";
	params.push(limit, offset);

	return getDb().query<MemoryRow, (string | number)[]>(sql).all(...params);
}

export function updateMemorySummary(id: string, summary: string): void {
	getDb().query("UPDATE memories SET summary = ? WHERE id = ?").run(summary, id);
}

export function deleteMemory(id: string): boolean {
	const result = getDb().query("DELETE FROM memories WHERE id = ?").run(id);
	return result.changes > 0;
}

export function getExpiredMemoryIds(limit: number): string[] {
	const rows = getDb()
		.query<{ id: string }, [number]>(
			"SELECT id FROM memories WHERE expires_at IS NOT NULL AND expires_at < datetime('now') LIMIT ?",
		)
		.all(limit);
	return rows.map((r) => r.id);
}

export function deleteMemoriesBatch(ids: string[]): number {
	if (ids.length === 0) return 0;
	const placeholders = ids.map(() => "?").join(", ");
	const result = getDb().query(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...ids);
	return result.changes;
}

export function listDistinctGitRemotes(userId?: string): string[] {
	if (userId) {
		const rows = getDb()
			.query<{ git_remote: string }, [string]>(
				"SELECT DISTINCT m.git_remote FROM memories m JOIN api_keys ak ON m.api_key_id = ak.id WHERE m.git_remote IS NOT NULL AND ak.user_id = ? ORDER BY m.git_remote",
			)
			.all(userId);
		return rows.map((r) => r.git_remote);
	}
	const rows = getDb()
		.query<{ git_remote: string }, []>(
			"SELECT DISTINCT git_remote FROM memories WHERE git_remote IS NOT NULL ORDER BY git_remote",
		)
		.all();
	return rows.map((r) => r.git_remote);
}

export function listDistinctScopes(userId?: string): string[] {
	if (userId) {
		const rows = getDb()
			.query<{ scope: string }, [string]>(
				"SELECT DISTINCT m.scope FROM memories m JOIN api_keys ak ON m.api_key_id = ak.id WHERE ak.user_id = ? ORDER BY m.scope",
			)
			.all(userId);
		return rows.map((r) => r.scope);
	}
	const rows = getDb()
		.query<{ scope: string }, []>("SELECT DISTINCT scope FROM memories ORDER BY scope")
		.all();
	return rows.map((r) => r.scope);
}

export function countMemories(opts?: {
	gitRemote?: string;
	scope?: string;
	userId?: string;
}): number {
	const conditions: string[] = [EXPIRY_FILTER];
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

	sql += ` WHERE ${conditions.join(" AND ")}`;

	const row = getDb().query<{ count: number }, string[]>(sql).get(...params);
	return row?.count ?? 0;
}

// --- User Settings ---

export function getUserSetting(userId: string, key: string): string | undefined {
	const row = getDb()
		.query<{ value: string }, [string, string]>(
			"SELECT value FROM user_settings WHERE user_id = ? AND key = ?",
		)
		.get(userId, key);
	return row?.value;
}

export function setUserSetting(userId: string, key: string, value: string): void {
	getDb()
		.query("INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)")
		.run(userId, key, value);
}

export function deleteUserSetting(userId: string, key: string): boolean {
	const result = getDb()
		.query("DELETE FROM user_settings WHERE user_id = ? AND key = ?")
		.run(userId, key);
	return result.changes > 0;
}

// --- Workspaces ---

export interface WorkspaceRow {
	id: string;
	name: string;
	created_by: string;
	created_at: string;
}

export function createWorkspace(name: string, createdBy: string): string {
	const id = crypto.randomUUID();
	getDb()
		.query("INSERT INTO workspaces (id, name, created_by) VALUES (?, ?, ?)")
		.run(id, name, createdBy);
	return id;
}

export function getWorkspace(id: string): WorkspaceRow | undefined {
	return (
		getDb().query<WorkspaceRow, [string]>("SELECT * FROM workspaces WHERE id = ?").get(id) ??
		undefined
	);
}

export function getWorkspaceByName(name: string, userId?: string): WorkspaceRow | undefined {
	if (userId) {
		return (
			getDb()
				.query<WorkspaceRow, [string, string]>(
					"SELECT * FROM workspaces WHERE name = ? AND created_by = ?",
				)
				.get(name, userId) ?? undefined
		);
	}
	return (
		getDb().query<WorkspaceRow, [string]>("SELECT * FROM workspaces WHERE name = ?").get(name) ??
		undefined
	);
}

export interface WorkspaceWithCount extends WorkspaceRow {
	project_count: number;
}

export function listWorkspaces(userId?: string): WorkspaceWithCount[] {
	const base =
		"SELECT w.*, COUNT(wp.git_remote) as project_count FROM workspaces w LEFT JOIN workspace_projects wp ON w.id = wp.workspace_id";
	if (userId) {
		return getDb()
			.query<WorkspaceWithCount, [string]>(
				`${base} WHERE w.created_by = ? GROUP BY w.id ORDER BY w.name ASC`,
			)
			.all(userId);
	}
	return getDb()
		.query<WorkspaceWithCount, []>(`${base} GROUP BY w.id ORDER BY w.name ASC`)
		.all();
}

export function updateWorkspace(id: string, name: string, userId: string): boolean {
	const result = getDb()
		.query("UPDATE workspaces SET name = ? WHERE id = ? AND created_by = ?")
		.run(name, id, userId);
	return result.changes > 0;
}

export function deleteWorkspace(id: string): { deleted: boolean; rescopedMemories: number } {
	const db = getDb();
	const txn = db.transaction(() => {
		const rescoped = db
			.query(
				"UPDATE memories SET scope = 'project', workspace_id = NULL WHERE workspace_id = ? AND scope = 'workspace'",
			)
			.run(id);
		db.query("UPDATE memories SET workspace_id = NULL WHERE workspace_id = ?").run(id);
		const result = db.query("DELETE FROM workspaces WHERE id = ?").run(id);
		return { deleted: result.changes > 0, rescopedMemories: rescoped.changes };
	});
	return txn();
}

export function countWorkspaces(): number {
	const row = getDb()
		.query<{ count: number }, []>("SELECT COUNT(*) as count FROM workspaces")
		.get();
	return row?.count ?? 0;
}

export function assignProjectToWorkspace(workspaceId: string, gitRemote: string): void {
	getDb()
		.query("INSERT INTO workspace_projects (workspace_id, git_remote) VALUES (?, ?)")
		.run(workspaceId, gitRemote);
}

export function removeProjectFromWorkspace(workspaceId: string, gitRemote: string): boolean {
	const result = getDb()
		.query("DELETE FROM workspace_projects WHERE workspace_id = ? AND git_remote = ?")
		.run(workspaceId, gitRemote);
	return result.changes > 0;
}

export function listWorkspaceProjects(workspaceId: string): string[] {
	const rows = getDb()
		.query<{ git_remote: string }, [string]>(
			"SELECT git_remote FROM workspace_projects WHERE workspace_id = ? ORDER BY git_remote",
		)
		.all(workspaceId);
	return rows.map((r) => r.git_remote);
}

export function getWorkspaceForUser(id: string, userId: string): WorkspaceRow | undefined {
	return (
		getDb()
			.query<WorkspaceRow, [string, string]>(
				"SELECT * FROM workspaces WHERE id = ? AND created_by = ?",
			)
			.get(id, userId) ?? undefined
	);
}

export function getWorkspaceForProject(
	gitRemote: string,
	userId?: string,
): WorkspaceRow | undefined {
	if (userId) {
		return (
			getDb()
				.query<WorkspaceRow, [string, string]>(
					"SELECT w.* FROM workspaces w JOIN workspace_projects wp ON w.id = wp.workspace_id WHERE wp.git_remote = ? AND w.created_by = ?",
				)
				.get(gitRemote, userId) ?? undefined
		);
	}
	return (
		getDb()
			.query<WorkspaceRow, [string]>(
				"SELECT w.* FROM workspaces w JOIN workspace_projects wp ON w.id = wp.workspace_id WHERE wp.git_remote = ?",
			)
			.get(gitRemote) ?? undefined
	);
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
	getDb()
		.query(
			"INSERT INTO invites (id, email, token, role, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.run(id, params.email, token, params.role, params.createdBy, params.expiresAt);
	return { id, token };
}

export function getInviteByToken(token: string) {
	return getDb().query<InviteRow, [string]>("SELECT * FROM invites WHERE token = ?").get(token);
}

export function listInvites() {
	return getDb().query<InviteRow, []>("SELECT * FROM invites ORDER BY created_at DESC").all();
}

export function deleteInvite(id: string): boolean {
	const result = getDb().query("DELETE FROM invites WHERE id = ?").run(id);
	return result.changes > 0;
}

export function markInviteUsed(id: string) {
	getDb().query("UPDATE invites SET used_at = datetime('now') WHERE id = ?").run(id);
}

// --- Config ---

export function getConfig(key: string): string | undefined {
	const row = getDb()
		.query<{ value: string }, [string]>("SELECT value FROM config WHERE key = ?")
		.get(key);
	return row?.value;
}

export function setConfig(key: string, value: string): void {
	getDb().query("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(key, value);
}

export function deleteConfig(key: string): boolean {
	const result = getDb().query("DELETE FROM config WHERE key = ?").run(key);
	return result.changes > 0;
}

export function getConfigWithEnv(key: string, envVar: string): string | undefined {
	return process.env[envVar] ?? getConfig(key);
}

// --- JWT Secret ---

export function getOrCreateJwtSecret(): string {
	const envSecret = process.env.HUSK_JWT_SECRET;
	if (envSecret) return envSecret;

	const row = getDb()
		.query<{ value: string }, [string]>("SELECT value FROM config WHERE key = ?")
		.get("jwt_secret");

	if (row) return row.value;

	const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
	getDb().query("INSERT INTO config (key, value) VALUES (?, ?)").run("jwt_secret", secret);
	return secret;
}

