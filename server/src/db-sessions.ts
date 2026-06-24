import { getDb } from "./db.js";

// --- Sessions ---

export interface SessionRow {
	id: string;
	claude_session_id: string;
	api_key_id: string;
	project: string | null;
	status: string;
	summary: string | null;
	started_at: string;
	ended_at: string | null;
}

export function findSession(claudeSessionId: string, apiKeyId: string): SessionRow | undefined {
	return (
		getDb()
			.query<SessionRow, [string, string]>(
				"SELECT * FROM sessions WHERE claude_session_id = ? AND api_key_id = ?",
			)
			.get(claudeSessionId, apiKeyId) ?? undefined
	);
}

export function createSession(params: {
	claudeSessionId: string;
	apiKeyId: string;
	project?: string | null;
}): string {
	const id = crypto.randomUUID();
	getDb()
		.query(
			"INSERT INTO sessions (id, claude_session_id, api_key_id, project) VALUES (?, ?, ?, ?)",
		)
		.run(id, params.claudeSessionId, params.apiKeyId, params.project ?? null);
	return id;
}

export function findOrCreateSession(params: {
	claudeSessionId: string;
	apiKeyId: string;
	project?: string | null;
}): SessionRow {
	const existing = findSession(params.claudeSessionId, params.apiKeyId);
	if (existing) return existing;

	const id = createSession(params);
	return (
		findSession(params.claudeSessionId, params.apiKeyId) ?? {
			id,
			claude_session_id: params.claudeSessionId,
			api_key_id: params.apiKeyId,
			project: params.project ?? null,
			status: "active",
			summary: null,
			started_at: new Date().toISOString(),
			ended_at: null,
		}
	);
}

export function endSession(id: string): boolean {
	const result = getDb()
		.query("UPDATE sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?")
		.run(id);
	return result.changes > 0;
}

export function updateSessionSummary(id: string, summary: string): void {
	getDb().query("UPDATE sessions SET summary = ? WHERE id = ?").run(summary, id);
}

export function getSession(id: string): SessionRow | undefined {
	return getDb().query<SessionRow, [string]>("SELECT * FROM sessions WHERE id = ?").get(id) ?? undefined;
}

export function getSessionForUser(id: string, userId: string): SessionRow | undefined {
	return (
		getDb()
			.query<SessionRow, [string, string]>(
				"SELECT s.* FROM sessions s JOIN api_keys ak ON s.api_key_id = ak.id WHERE s.id = ? AND ak.user_id = ?",
			)
			.get(id, userId) ?? undefined
	);
}

export function listSessions(opts?: {
	userId?: string;
	project?: string;
	status?: string;
	limit?: number;
	offset?: number;
}): SessionRow[] {
	const conditions: string[] = [];
	const params: (string | number)[] = [];

	if (opts?.userId) {
		conditions.push("ak.user_id = ?");
		params.push(opts.userId);
	}
	if (opts?.project) {
		conditions.push("s.project = ?");
		params.push(opts.project);
	}
	if (opts?.status) {
		conditions.push("s.status = ?");
		params.push(opts.status);
	}

	const needsJoin = opts?.userId != null;
	let sql = needsJoin
		? "SELECT s.* FROM sessions s JOIN api_keys ak ON s.api_key_id = ak.id"
		: "SELECT * FROM sessions s";

	if (conditions.length > 0) {
		sql += ` WHERE ${conditions.join(" AND ")}`;
	}
	sql += " ORDER BY s.started_at DESC";

	const limit = opts?.limit ?? 50;
	const offset = opts?.offset ?? 0;
	sql += " LIMIT ? OFFSET ?";
	params.push(limit, offset);

	return getDb().query<SessionRow, (string | number)[]>(sql).all(...params);
}

export function countSessions(opts?: { userId?: string; status?: string }): number {
	const conditions: string[] = [];
	const params: string[] = [];

	if (opts?.userId) {
		conditions.push("ak.user_id = ?");
		params.push(opts.userId);
	}
	if (opts?.status) {
		conditions.push("s.status = ?");
		params.push(opts.status);
	}

	const needsJoin = opts?.userId != null;
	let sql = needsJoin
		? "SELECT COUNT(*) as count FROM sessions s JOIN api_keys ak ON s.api_key_id = ak.id"
		: "SELECT COUNT(*) as count FROM sessions s";

	if (conditions.length > 0) {
		sql += ` WHERE ${conditions.join(" AND ")}`;
	}

	const row = getDb().query<{ count: number }, string[]>(sql).get(...params);
	return row?.count ?? 0;
}

export function deleteSession(id: string): boolean {
	const db = getDb();
	const txn = db.transaction(() => {
		db.query("DELETE FROM observations WHERE session_id = ?").run(id);
		const result = db.query("DELETE FROM sessions WHERE id = ?").run(id);
		return result.changes > 0;
	});
	return txn();
}

export function getRecentSessionSummaries(opts: {
	userId: string;
	project?: string | null;
	limit?: number;
}): SessionRow[] {
	const conditions = ["ak.user_id = ?", "s.summary IS NOT NULL"];
	const params: (string | number)[] = [opts.userId];

	if (opts.project) {
		conditions.push("s.project = ?");
		params.push(opts.project);
	}

	const limit = opts.limit ?? 5;
	params.push(limit);

	return getDb()
		.query<SessionRow, (string | number)[]>(
			`SELECT s.* FROM sessions s
			 JOIN api_keys ak ON s.api_key_id = ak.id
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY s.started_at DESC
			 LIMIT ?`,
		)
		.all(...params);
}

export function getUncompressedSessions(): SessionRow[] {
	return getDb()
		.query<SessionRow, []>(
			`SELECT DISTINCT s.* FROM sessions s
			 JOIN observations o ON o.session_id = s.id
			 WHERE s.status = 'ended' AND o.compressed = 0
			 ORDER BY s.ended_at ASC`,
		)
		.all();
}

export function getStaleActiveSessions(intervalMinutes: number): SessionRow[] {
	return getDb()
		.query<SessionRow, [number]>(
			`SELECT DISTINCT s.* FROM sessions s
			 JOIN observations o ON o.session_id = s.id
			 WHERE s.status = 'active' AND o.compressed = 0
			 AND o.created_at <= datetime('now', '-' || ? || ' minutes')
			 ORDER BY s.started_at ASC`,
		)
		.all(intervalMinutes);
}

// --- Observations ---

export interface ObservationRow {
	id: string;
	session_id: string;
	event: string;
	tool_name: string | null;
	content: string;
	prompt: string | null;
	tool_input_summary: string | null;
	files_modified: string | null;
	compressed: number;
	created_at: string;
}

export function createObservation(params: {
	sessionId: string;
	event: string;
	toolName?: string | null;
	content: string;
	prompt?: string | null;
	toolInputSummary?: string | null;
	filesModified?: string | null;
}): string {
	const id = crypto.randomUUID();
	const truncated =
		params.content.length > 50_000 ? params.content.slice(0, 50_000) : params.content;
	getDb()
		.query(
			`INSERT INTO observations (id, session_id, event, tool_name, content, prompt, tool_input_summary, files_modified)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			params.sessionId,
			params.event,
			params.toolName ?? null,
			truncated,
			params.prompt ?? null,
			params.toolInputSummary ?? null,
			params.filesModified ?? null,
		);
	return id;
}

export function getObservation(id: string): ObservationRow | undefined {
	return (
		getDb().query<ObservationRow, [string]>("SELECT * FROM observations WHERE id = ?").get(id) ??
		undefined
	);
}

export function getObservationForUser(id: string, userId: string): ObservationRow | undefined {
	return (
		getDb()
			.query<ObservationRow, [string, string]>(
				"SELECT o.* FROM observations o JOIN sessions s ON o.session_id = s.id JOIN api_keys k ON s.api_key_id = k.id WHERE o.id = ? AND k.user_id = ?",
			)
			.get(id, userId) ?? undefined
	);
}

export function listObservations(sessionId: string): ObservationRow[] {
	return getDb()
		.query<ObservationRow, [string]>(
			"SELECT * FROM observations WHERE session_id = ? ORDER BY created_at ASC",
		)
		.all(sessionId);
}

export function countObservations(sessionId: string): number {
	const row = getDb()
		.query<{ count: number }, [string]>(
			"SELECT COUNT(*) as count FROM observations WHERE session_id = ?",
		)
		.get(sessionId);
	return row?.count ?? 0;
}

export function getUncompressedObservations(sessionId: string): ObservationRow[] {
	return getDb()
		.query<ObservationRow, [string]>(
			"SELECT * FROM observations WHERE session_id = ? AND compressed = 0 ORDER BY created_at ASC",
		)
		.all(sessionId);
}

export function countUncompressedObservations(sessionId: string): number {
	const row = getDb()
		.query<{ count: number }, [string]>(
			"SELECT COUNT(*) as count FROM observations WHERE session_id = ? AND compressed = 0",
		)
		.get(sessionId);
	return row?.count ?? 0;
}

export function getSessionFilesModified(sessionId: string): string[] {
	const rows = getDb()
		.query<{ files_modified: string }, [string]>(
			"SELECT DISTINCT files_modified FROM observations WHERE session_id = ? AND files_modified IS NOT NULL",
		)
		.all(sessionId);

	const files = new Set<string>();
	for (const row of rows) {
		try {
			const parsed = JSON.parse(row.files_modified) as string[];
			for (const f of parsed) files.add(f);
		} catch {
			/* skip malformed */
		}
	}
	return [...files];
}

export function markObservationsCompressed(sessionId: string): void {
	getDb()
		.query("UPDATE observations SET compressed = 1 WHERE session_id = ? AND compressed = 0")
		.run(sessionId);
}

export function markObservationsByIds(ids: string[]): number {
	if (ids.length === 0) return 0;
	const placeholders = ids.map(() => "?").join(", ");
	const result = getDb()
		.query(
			`UPDATE observations SET compressed = 1 WHERE id IN (${placeholders}) AND compressed = 0`,
		)
		.run(...ids);
	return result.changes;
}

export function getUncompressedObservationsForUser(
	sessionId: string,
	userId: string,
	limit?: number,
): ObservationRow[] {
	const effectiveLimit = Math.min(Math.max(limit ?? 50, 1), 100);
	return getDb()
		.query<ObservationRow, [string, string, number]>(
			`SELECT o.* FROM observations o
			 JOIN sessions s ON o.session_id = s.id
			 JOIN api_keys k ON s.api_key_id = k.id
			 WHERE o.session_id = ? AND k.user_id = ? AND o.compressed = 0
			 ORDER BY o.created_at ASC
			 LIMIT ?`,
		)
		.all(sessionId, userId, effectiveLimit);
}

export function validateObservationsBelongToSession(ids: string[], sessionId: string): boolean {
	if (ids.length === 0) return true;
	const placeholders = ids.map(() => "?").join(", ");
	const row = getDb()
		.query<{ count: number }, string[]>(
			`SELECT COUNT(*) as count FROM observations WHERE id IN (${placeholders}) AND session_id = ?`,
		)
		.get(...ids, sessionId);
	return (row?.count ?? 0) === ids.length;
}

export function validateObservationIds(ids: string[], userId: string): boolean {
	if (ids.length === 0) return true;
	const placeholders = ids.map(() => "?").join(", ");
	const row = getDb()
		.query<{ count: number }, string[]>(
			`SELECT COUNT(*) as count FROM observations o
			 JOIN sessions s ON o.session_id = s.id
			 JOIN api_keys k ON s.api_key_id = k.id
			 WHERE o.id IN (${placeholders}) AND k.user_id = ?`,
		)
		.get(...ids, userId);
	return (row?.count ?? 0) === ids.length;
}
