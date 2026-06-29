import { getDb } from "./db.js";

// --- Memory Types ---

export const MEMORY_TYPES = [
	"decision",
	"solution",
	"lesson",
	"fact",
	"convention",
	"goal",
	"session",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export function isValidMemoryType(value: string): value is MemoryType {
	return MEMORY_TYPES.includes(value as MemoryType);
}

// --- Filters ---

const ACTIVE_FILTER =
	"(m.expires_at IS NULL OR m.expires_at > datetime('now')) AND m.deleted_at IS NULL";

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
	title: string | null;
	slug: string | null;
	memory_type: string | null;
	path: string | null;
	updated_at: string | null;
	deleted_at: string | null;
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
	title?: string | null;
	slug?: string | null;
	memoryType?: string | null;
	path?: string | null;
}): MemoryRow {
	const db = getDb();
	db.query(
		`INSERT INTO memories (id, api_key_id, git_remote, scope, summary, metadata, expires_at, workspace_id, title, slug, memory_type, path)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		params.id,
		params.apiKeyId,
		params.gitRemote ?? null,
		params.scope,
		params.summary,
		params.metadata ?? null,
		params.expiresAt ?? null,
		params.workspaceId ?? null,
		params.title ?? null,
		params.slug ?? null,
		params.memoryType ?? null,
		params.path ?? null,
	);
	return db
		.query<MemoryRow, [string]>("SELECT * FROM memories WHERE id = ?")
		.get(params.id) as MemoryRow;
}

export function getMemory(id: string): MemoryRow | undefined {
	return (
		getDb()
			.query<MemoryRow, [string]>(`SELECT * FROM memories m WHERE m.id = ? AND ${ACTIVE_FILTER}`)
			.get(id) ?? undefined
	);
}

export function getMemoryForUser(id: string, userId: string): MemoryRow | undefined {
	return (
		getDb()
			.query<MemoryRow, [string, string]>(
				`SELECT m.* FROM memories m JOIN api_keys k ON m.api_key_id = k.id WHERE m.id = ? AND k.user_id = ? AND ${ACTIVE_FILTER}`,
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
	memoryType?: string;
	path?: string;
	includeDeleted?: boolean;
}): MemoryRow[] {
	const db = getDb();
	const conditions: string[] = [];
	const params: (string | number)[] = [];

	if (!opts?.includeDeleted) {
		conditions.push(ACTIVE_FILTER);
	}
	if (opts?.gitRemote) {
		conditions.push("m.git_remote = ?");
		params.push(opts.gitRemote);
	}
	if (opts?.scope) {
		conditions.push("m.scope = ?");
		params.push(opts.scope);
	}
	if (opts?.userId) {
		conditions.push("k.user_id = ?");
		params.push(opts.userId);
	}
	if (opts?.memoryType) {
		conditions.push("m.memory_type = ?");
		params.push(opts.memoryType);
	}
	if (opts?.path) {
		conditions.push("m.path = ?");
		params.push(opts.path);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const limit = Math.min(opts?.limit ?? 50, 200);
	const offset = opts?.offset ?? 0;
	params.push(limit, offset);

	return db
		.query<MemoryRow, (string | number)[]>(
			`SELECT m.* FROM memories m JOIN api_keys k ON m.api_key_id = k.id ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
		)
		.all(...params);
}

export function updateMemorySummary(id: string, summary: string): void {
	getDb()
		.query("UPDATE memories SET summary = ?, updated_at = datetime('now') WHERE id = ?")
		.run(summary, id);
}

export function updateMemoryFields(
	id: string,
	fields: {
		summary?: string;
		title?: string | null;
		slug?: string | null;
		memoryType?: string | null;
		path?: string | null;
		scope?: string;
		gitRemote?: string | null;
		metadata?: string | null;
	},
): boolean {
	const db = getDb();
	const sets: string[] = ["updated_at = datetime('now')"];
	const params: (string | null)[] = [];

	if (fields.summary !== undefined) {
		sets.push("summary = ?");
		params.push(fields.summary);
	}
	if (fields.title !== undefined) {
		sets.push("title = ?");
		params.push(fields.title);
	}
	if (fields.slug !== undefined) {
		sets.push("slug = ?");
		params.push(fields.slug);
	}
	if (fields.memoryType !== undefined) {
		sets.push("memory_type = ?");
		params.push(fields.memoryType);
	}
	if (fields.path !== undefined) {
		sets.push("path = ?");
		params.push(fields.path);
	}
	if (fields.scope !== undefined) {
		sets.push("scope = ?");
		params.push(fields.scope);
	}
	if (fields.gitRemote !== undefined) {
		sets.push("git_remote = ?");
		params.push(fields.gitRemote);
	}
	if (fields.metadata !== undefined) {
		sets.push("metadata = ?");
		params.push(fields.metadata);
	}

	if (sets.length <= 1) return false;

	params.push(id);
	const result = db.query(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`).run(...params);
	return result.changes > 0;
}

export function softDeleteMemory(id: string): boolean {
	const result = getDb()
		.query("UPDATE memories SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL")
		.run(id);
	return result.changes > 0;
}

export function restoreMemory(id: string): boolean {
	const result = getDb()
		.query("UPDATE memories SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL")
		.run(id);
	return result.changes > 0;
}

export function generateUniqueSlug(
	baseSlug: string,
	gitRemote: string | null,
	excludeId?: string,
): string {
	const db = getDb();
	let slug = baseSlug;
	let counter = 0;

	for (;;) {
		const conditions = ["slug = ?"];
		const params: (string | null)[] = [slug];

		if (gitRemote) {
			conditions.push("git_remote = ?");
			params.push(gitRemote);
		} else {
			conditions.push("git_remote IS NULL");
		}

		if (excludeId) {
			conditions.push("id != ?");
			params.push(excludeId);
		}

		conditions.push("deleted_at IS NULL");

		const existing = db
			.query(`SELECT id FROM memories WHERE ${conditions.join(" AND ")} LIMIT 1`)
			.get(...params);

		if (!existing) return slug;

		counter++;
		slug = `${baseSlug}-${counter}`;
	}
}

export function deleteMemory(id: string): boolean {
	const result = getDb().query("DELETE FROM memories WHERE id = ?").run(id);
	return result.changes > 0;
}

export function getExpiredMemoryIds(limit: number): string[] {
	const rows = getDb()
		.query<{ id: string }, [string, number]>(
			"SELECT id FROM memories WHERE expires_at IS NOT NULL AND expires_at < ? LIMIT ?",
		)
		.all(new Date().toISOString(), limit);
	return rows.map((r) => r.id);
}

export function getSoftDeletedMemoryIds(graceDays: number, limit: number): string[] {
	const cutoff = new Date(Date.now() - graceDays * 86_400_000).toISOString();
	const rows = getDb()
		.query<{ id: string }, [string, number]>(
			"SELECT id FROM memories WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT ?",
		)
		.all(cutoff, limit);
	return rows.map((r) => r.id);
}

export function deleteMemoriesBatch(ids: string[]): number {
	if (ids.length === 0) return 0;
	const db = getDb();
	const placeholders = ids.map(() => "?").join(",");
	const result = db.query(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...ids);
	return result.changes;
}

export function listDistinctGitRemotes(userId?: string): string[] {
	const db = getDb();
	if (userId) {
		return db
			.query<{ git_remote: string }, [string]>(
				"SELECT DISTINCT m.git_remote FROM memories m JOIN api_keys k ON m.api_key_id = k.id WHERE m.git_remote IS NOT NULL AND m.deleted_at IS NULL AND k.user_id = ? ORDER BY m.git_remote",
			)
			.all(userId)
			.map((r) => r.git_remote);
	}
	return db
		.query<{ git_remote: string }, []>(
			"SELECT DISTINCT git_remote FROM memories WHERE git_remote IS NOT NULL AND deleted_at IS NULL ORDER BY git_remote",
		)
		.all()
		.map((r) => r.git_remote);
}

export function listDistinctScopes(userId?: string): string[] {
	const db = getDb();
	if (userId) {
		return db
			.query<{ scope: string }, [string]>(
				"SELECT DISTINCT m.scope FROM memories m JOIN api_keys k ON m.api_key_id = k.id WHERE m.deleted_at IS NULL AND k.user_id = ? ORDER BY m.scope",
			)
			.all(userId)
			.map((r) => r.scope);
	}
	return db
		.query<{ scope: string }, []>(
			"SELECT DISTINCT scope FROM memories WHERE deleted_at IS NULL ORDER BY scope",
		)
		.all()
		.map((r) => r.scope);
}

export function listDistinctMemoryTypes(userId?: string): string[] {
	const db = getDb();
	if (userId) {
		return db
			.query<{ memory_type: string }, [string]>(
				"SELECT DISTINCT m.memory_type FROM memories m JOIN api_keys k ON m.api_key_id = k.id WHERE m.memory_type IS NOT NULL AND m.deleted_at IS NULL AND k.user_id = ? ORDER BY m.memory_type",
			)
			.all(userId)
			.map((r) => r.memory_type);
	}
	return db
		.query<{ memory_type: string }, []>(
			"SELECT DISTINCT memory_type FROM memories WHERE memory_type IS NOT NULL AND deleted_at IS NULL ORDER BY memory_type",
		)
		.all()
		.map((r) => r.memory_type);
}

export function listDistinctPaths(userId?: string): string[] {
	const db = getDb();
	if (userId) {
		return db
			.query<{ path: string }, [string]>(
				"SELECT DISTINCT m.path FROM memories m JOIN api_keys k ON m.api_key_id = k.id WHERE m.path IS NOT NULL AND m.deleted_at IS NULL AND k.user_id = ? ORDER BY m.path",
			)
			.all(userId)
			.map((r) => r.path);
	}
	return db
		.query<{ path: string }, []>(
			"SELECT DISTINCT path FROM memories WHERE path IS NOT NULL AND deleted_at IS NULL ORDER BY path",
		)
		.all()
		.map((r) => r.path);
}

export function countMemories(opts?: {
	gitRemote?: string;
	scope?: string;
	userId?: string;
	memoryType?: string;
	path?: string;
	includeDeleted?: boolean;
}): number {
	const db = getDb();
	const conditions: string[] = [];
	if (!opts?.includeDeleted) {
		conditions.push(ACTIVE_FILTER);
	}
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
		conditions.push("k.user_id = ?");
		params.push(opts.userId);
	}
	if (opts?.memoryType) {
		conditions.push("m.memory_type = ?");
		params.push(opts.memoryType);
	}
	if (opts?.path) {
		conditions.push("m.path = ?");
		params.push(opts.path);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const row = db
		.query<{ count: number }, string[]>(
			`SELECT COUNT(*) as count FROM memories m JOIN api_keys k ON m.api_key_id = k.id ${where}`,
		)
		.get(...params);
	return row?.count ?? 0;
}

// --- Knowledge tree ---

export interface KnowledgeTreeNode {
	project: string;
	workspace: string | null;
	workspace_id: string | null;
	memory_type: string;
	count: number;
}

export function getKnowledgeTree(userId?: string): KnowledgeTreeNode[] {
	const db = getDb();
	const userFilter = userId ? " AND k.user_id = ?" : "";
	const params = userId ? [userId] : [];

	return db
		.query<KnowledgeTreeNode, string[]>(
			`SELECT COALESCE(m.git_remote, '__general__') as project,
			        w.name as workspace,
			        w.id as workspace_id,
			        COALESCE(m.memory_type, 'untyped') as memory_type,
			        COUNT(*) as count
			 FROM memories m
			 JOIN api_keys k ON m.api_key_id = k.id
			 LEFT JOIN workspace_projects wp ON m.git_remote = wp.git_remote
			 LEFT JOIN workspaces w ON wp.workspace_id = w.id
			 WHERE ${ACTIVE_FILTER}${userFilter}
			 GROUP BY project, workspace, memory_type
			 ORDER BY workspace, project, memory_type`,
		)
		.all(...params);
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
		.query(
			"INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
		)
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
	const db = getDb();
	const id = crypto.randomUUID();
	db.query("INSERT INTO workspaces (id, name, created_by) VALUES (?, ?, ?)").run(
		id,
		name,
		createdBy,
	);
	return id;
}

export function getWorkspace(id: string): WorkspaceRow | undefined {
	return (
		getDb().query<WorkspaceRow, [string]>("SELECT * FROM workspaces WHERE id = ?").get(id) ??
		undefined
	);
}

export function getWorkspaceByName(name: string, userId?: string): WorkspaceRow | undefined {
	const db = getDb();
	if (userId) {
		return (
			db
				.query<WorkspaceRow, [string, string]>(
					"SELECT * FROM workspaces WHERE name = ? AND created_by = ?",
				)
				.get(name, userId) ?? undefined
		);
	}
	return (
		db.query<WorkspaceRow, [string]>("SELECT * FROM workspaces WHERE name = ?").get(name) ??
		undefined
	);
}

export interface WorkspaceWithCount extends WorkspaceRow {
	project_count: number;
}

export function listWorkspaces(userId?: string): WorkspaceWithCount[] {
	const db = getDb();
	const query = userId
		? "SELECT w.*, (SELECT COUNT(*) FROM workspace_projects wp WHERE wp.workspace_id = w.id) as project_count FROM workspaces w WHERE w.created_by = ? ORDER BY w.name"
		: "SELECT w.*, (SELECT COUNT(*) FROM workspace_projects wp WHERE wp.workspace_id = w.id) as project_count FROM workspaces w ORDER BY w.name";

	return userId
		? db.query<WorkspaceWithCount, [string]>(query).all(userId)
		: db.query<WorkspaceWithCount, []>(query).all();
}

export function updateWorkspace(id: string, name: string, userId: string): boolean {
	const result = getDb()
		.query("UPDATE workspaces SET name = ? WHERE id = ? AND created_by = ?")
		.run(name, id, userId);
	return result.changes > 0;
}

export function deleteWorkspace(id: string): { deleted: boolean; rescopedMemories: number } {
	const db = getDb();
	const result = db.query("DELETE FROM workspaces WHERE id = ?").run(id);
	const rescoped = db
		.query("UPDATE memories SET workspace_id = NULL, scope = 'project' WHERE workspace_id = ?")
		.run(id);
	return { deleted: result.changes > 0, rescopedMemories: rescoped.changes };
}

export function countWorkspaces(): number {
	const row = getDb()
		.query<{ count: number }, []>("SELECT COUNT(*) as count FROM workspaces")
		.get();
	return row?.count ?? 0;
}

export function assignProjectToWorkspace(workspaceId: string, gitRemote: string): void {
	getDb()
		.query(
			"INSERT INTO workspace_projects (workspace_id, git_remote) VALUES (?, ?) ON CONFLICT(git_remote) DO UPDATE SET workspace_id = excluded.workspace_id",
		)
		.run(workspaceId, gitRemote);
}

export function removeProjectFromWorkspace(workspaceId: string, gitRemote: string): boolean {
	const result = getDb()
		.query("DELETE FROM workspace_projects WHERE workspace_id = ? AND git_remote = ?")
		.run(workspaceId, gitRemote);
	return result.changes > 0;
}

export function listWorkspaceProjects(workspaceId: string): string[] {
	return getDb()
		.query<{ git_remote: string }, [string]>(
			"SELECT git_remote FROM workspace_projects WHERE workspace_id = ? ORDER BY git_remote",
		)
		.all(workspaceId)
		.map((r) => r.git_remote);
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
	const db = getDb();
	if (userId) {
		return (
			db
				.query<WorkspaceRow, [string, string]>(
					`SELECT w.* FROM workspaces w
				 JOIN workspace_projects wp ON w.id = wp.workspace_id
				 WHERE wp.git_remote = ? AND w.created_by = ?`,
				)
				.get(gitRemote, userId) ?? undefined
		);
	}
	return (
		db
			.query<WorkspaceRow, [string]>(
				`SELECT w.* FROM workspaces w
			 JOIN workspace_projects wp ON w.id = wp.workspace_id
			 WHERE wp.git_remote = ?`,
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
	const db = getDb();
	const id = crypto.randomUUID();
	const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
	db.query(
		"INSERT INTO invites (id, email, token, role, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
	).run(id, params.email, token, params.role, params.createdBy, params.expiresAt);
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
	getDb()
		.query(
			"INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		)
		.run(key, value);
}

export function deleteConfig(key: string): boolean {
	const result = getDb().query("DELETE FROM config WHERE key = ?").run(key);
	return result.changes > 0;
}

export function getConfigWithEnv(key: string, envVar: string): string | undefined {
	return process.env[envVar] ?? getConfig(key);
}

export function getOrCreateJwtSecret(): string {
	const existing = getConfig("jwt_secret");
	if (existing) return existing;

	const envSecret = process.env.HUSK_JWT_SECRET;
	if (envSecret) {
		setConfig("jwt_secret", envSecret);
		return envSecret;
	}

	const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
	setConfig("jwt_secret", secret);
	return secret;
}
