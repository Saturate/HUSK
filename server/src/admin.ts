import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { getLogger } from "@logtape/logtape";
import { Hono } from "hono";
import { jwtMiddleware } from "./auth.js";
import { parseSummary, setCompressionProvider } from "./compression.js";
import {
	UserScope,
	assignProjectToWorkspace,
	countMemories,
	countObservations,
	countSessions,
	countWorkspaces,
	createWorkspace,
	deleteConfig,
	deleteMemory,
	deleteSession,
	deleteWorkspace,
	getConfig,
	getDb,
	getKnowledgeTree,
	getMemory,
	getSession,
	getUserSetting,
	getWorkspace,
	getWorkspaceForProject,
	getWorkspaceForUser,
	listApiKeys,
	listDistinctGitRemotes,
	listDistinctMemoryTypes,
	listDistinctPaths,
	listDistinctScopes,
	listMemories,
	listObservations,
	listSessions,
	listWorkspaceProjects,
	listWorkspaces,
	removeProjectFromWorkspace,
	restoreMemory,
	setConfig,
	setUserSetting,
	softDeleteMemory,
	updateWorkspace,
} from "./db.js";
import { getProvider } from "./embeddings.js";
import type { AppEnv } from "./env.js";
import { isDuplicate, storeMemory } from "./ingest.js";
import { resetPrivacyCache } from "./privacy.js";
import { getStorageProvider } from "./storage.js";

const log = getLogger(["husk", "admin"]);

const admin = new Hono<AppEnv>();

admin.use("*", jwtMiddleware);

// --- Stats ---

admin.get("/stats", (c) => {
	const isAdmin = c.get("role") === "admin";
	const userId = isAdmin ? undefined : c.get("userId");

	const memoryCount = countMemories({ userId });
	const keys = isAdmin ? listApiKeys() : listApiKeys(c.get("userId"));
	const projects = listDistinctGitRemotes(userId);
	const activeKeys = keys.filter((k) => k.is_active).length;
	const totalSessions = countSessions({ userId });
	const activeSessions = countSessions({ userId, status: "active" });

	return c.json({
		memories: memoryCount,
		keys: { total: keys.length, active: activeKeys },
		projects: projects.length,
		sessions: { total: totalSessions, active: activeSessions },
		workspaces: countWorkspaces(),
	});
});

// --- Filters ---

admin.get("/filters", (c) => {
	const isAdmin = c.get("role") === "admin";
	const userId = isAdmin ? undefined : c.get("userId");
	const memoryProjects = listDistinctGitRemotes(userId);
	// Also include projects from telemetry traces
	const traceProjects = getDb()
		.query<{ project: string }, []>(
			"SELECT DISTINCT project FROM traces WHERE project IS NOT NULL AND project != '' ORDER BY project",
		)
		.all()
		.map((r) => r.project);
	const projects = [...new Set([...memoryProjects, ...traceProjects])].sort();
	const scopes = listDistinctScopes(userId);
	const types = listDistinctMemoryTypes(userId);
	const paths = listDistinctPaths(userId);
	return c.json({ projects, scopes, types, paths });
});

// --- Knowledge tree ---

admin.get("/knowledge/tree", (c) => {
	const isAdmin = c.get("role") === "admin";
	const userId = isAdmin ? undefined : c.get("userId");
	const nodes = getKnowledgeTree(userId);

	interface ProjectEntry {
		project: string;
		workspace: string | null;
		workspace_id: string | null;
		types: Record<string, number>;
		total: number;
	}

	const projectMap = new Map<string, ProjectEntry>();
	for (const node of nodes) {
		const entry = projectMap.get(node.project) ?? {
			project: node.project,
			workspace: node.workspace,
			workspace_id: node.workspace_id,
			types: {},
			total: 0,
		};
		entry.types[node.memory_type] = (entry.types[node.memory_type] ?? 0) + node.count;
		entry.total += node.count;
		projectMap.set(node.project, entry);
	}

	const projects = Array.from(projectMap.values());
	projects.sort((a, b) => {
		if (a.project === "__general__") return -1;
		if (b.project === "__general__") return 1;
		const wsA = a.workspace ?? "￿";
		const wsB = b.workspace ?? "￿";
		if (wsA !== wsB) return wsA.localeCompare(wsB);
		return a.project.localeCompare(b.project);
	});

	// Group into workspaces for the UI
	interface WorkspaceEntry {
		workspace: string;
		workspace_id: string | null;
		projects: ProjectEntry[];
		total: number;
	}

	const workspaceMap = new Map<string, WorkspaceEntry>();
	for (const p of projects) {
		if (p.project === "__general__") continue;
		const wsKey = p.workspace ?? "__unassigned__";
		const ws = workspaceMap.get(wsKey) ?? {
			workspace: p.workspace ?? "__unassigned__",
			workspace_id: p.workspace_id,
			projects: [],
			total: 0,
		};
		ws.projects.push(p);
		ws.total += p.total;
		workspaceMap.set(wsKey, ws);
	}

	const workspaces = Array.from(workspaceMap.values());
	workspaces.sort((a, b) => {
		if (a.workspace === "__unassigned__") return 1;
		if (b.workspace === "__unassigned__") return -1;
		return a.workspace.localeCompare(b.workspace);
	});

	return c.json({ workspaces, projects });
});

// --- Search ---

admin.post("/search", async (c) => {
	const body = await c.req.json<{
		query?: string;
		git_remote?: string;
		scope?: string;
		limit?: number;
	}>();

	const query = body.query?.trim();
	if (!query) {
		return c.json({ error: "query is required." }, 400);
	}

	const limit = body.limit ?? 10;
	const isAdmin = c.get("role") === "admin";

	try {
		const vector = await getProvider().embed(query);
		const filter: { git_remote?: string; scope?: string; user_id?: string } = {};
		if (body.git_remote) filter.git_remote = body.git_remote;
		if (body.scope) filter.scope = body.scope;
		if (!isAdmin) filter.user_id = c.get("userId");

		const results = await getStorageProvider().search(
			vector,
			Object.keys(filter).length > 0 ? filter : undefined,
			limit,
		);

		// Enrich with full memory data from SQLite
		const getMemoryFn = isAdmin
			? (id: string) => getMemory(id)
			: (id: string) => new UserScope(c.get("userId")).getMemory(id);
		const memories = results
			.map((r) => {
				const memory = getMemoryFn(r.id);
				if (!memory) return null;
				return { score: r.score, ...memory };
			})
			.filter((m) => m !== null);

		return c.json({ results: memories });
	} catch (err) {
		if (err instanceof Error) log.error("Search failed: {error}", { error: err.message });
		return c.json({ error: "Search service unavailable." }, 502);
	}
});

// --- Memories ---

admin.get("/memories", (c) => {
	const gitRemote = c.req.query("git_remote");
	const scope = c.req.query("scope");
	const memoryType = c.req.query("memory_type");
	const path = c.req.query("path");
	const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
	const offset = Math.max(Number(c.req.query("offset")) || 0, 0);
	const isAdmin = c.get("role") === "admin";
	// Only admins can view soft-deleted memories
	const includeDeleted = isAdmin && c.req.query("include_deleted") === "true";
	const userId = isAdmin ? undefined : c.get("userId");

	const memories = listMemories({
		gitRemote,
		scope,
		memoryType,
		path,
		includeDeleted,
		limit,
		offset,
		userId,
	});
	const total = countMemories({ gitRemote, scope, memoryType, includeDeleted, userId });

	return c.json({ memories, total });
});

admin.delete("/memories/:id", (c) => {
	const id = c.req.param("id");

	if (c.get("role") !== "admin") {
		const userDb = new UserScope(c.get("userId"));
		if (!userDb.softDeleteMemory(id)) {
			return c.json({ error: "Memory not found." }, 404);
		}
	} else {
		const memory = getMemory(id);
		if (!memory) {
			return c.json({ error: "Memory not found." }, 404);
		}
		softDeleteMemory(id);
	}

	return c.json({ id, soft_deleted: true });
});

admin.post("/memories/:id/restore", (c) => {
	const id = c.req.param("id");

	if (c.get("role") !== "admin") {
		const userDb = new UserScope(c.get("userId"));
		if (!userDb.restoreMemory(id)) {
			return c.json({ error: "Memory not found or not deleted." }, 404);
		}
	} else {
		if (!restoreMemory(id)) {
			return c.json({ error: "Memory not found or not deleted." }, 404);
		}
	}

	return c.json({ id, restored: true });
});

// --- Sessions ---

admin.get("/sessions", (c) => {
	const isAdmin = c.get("role") === "admin";
	const userId = isAdmin ? undefined : c.get("userId");
	const project = c.req.query("project") || undefined;
	const status = c.req.query("status") || undefined;
	const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
	const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

	const sessionsList = listSessions({ userId, project, status, limit, offset });
	const total = countSessions({ userId, status });

	const enriched = sessionsList.map((s) => ({
		...s,
		observation_count: countObservations(s.id),
	}));

	return c.json({ sessions: enriched, total });
});

admin.get("/sessions/:id", (c) => {
	const id = c.req.param("id");

	const session =
		c.get("role") === "admin" ? getSession(id) : new UserScope(c.get("userId")).getSession(id);

	if (!session) {
		return c.json({ error: "Session not found." }, 404);
	}

	const observations = listObservations(session.id);
	const parsed_summary = session.summary ? parseSummary(session.summary) : null;
	return c.json({ session, parsed_summary, observations });
});

admin.delete("/sessions/:id", (c) => {
	const id = c.req.param("id");

	if (c.get("role") !== "admin") {
		const userDb = new UserScope(c.get("userId"));
		if (!userDb.deleteSession(id)) {
			return c.json({ error: "Session not found." }, 404);
		}
	} else {
		const session = getSession(id);
		if (!session) {
			return c.json({ error: "Session not found." }, 404);
		}
		deleteSession(id);
	}

	return c.json({ id, deleted: true });
});

// --- Settings (config) ---

const CONFIG_KEYS = [
	"memory_mode",
	"compression_mode",
	"compression_provider",
	"compression_model",
	"compression_api_key",
	"compression_base_url",
	"compression_batch_size",
	"compression_interval_minutes",
	"session_context_count",
	"privacy_patterns",
	"dedup_threshold",
	"ttl_default_session",
	"ttl_default_project",
	"ttl_default_workspace",
	"ttl_default_global",
	"ttl_max",
] as const;

admin.get("/settings", (c) => {
	if (c.get("role") !== "admin") {
		return c.json({ error: "Forbidden." }, 403);
	}

	const settings: Record<string, string | null> = {};
	for (const key of CONFIG_KEYS) {
		const value = getConfig(key) ?? null;
		// Never expose secret values in plaintext
		if (key === "compression_api_key" && value) {
			settings[key] = `${value.slice(0, 4)}${"*".repeat(8)}`;
		} else {
			settings[key] = value;
		}
	}

	return c.json({ settings });
});

admin.put("/settings", async (c) => {
	if (c.get("role") !== "admin") {
		return c.json({ error: "Forbidden." }, 403);
	}

	const body = await c.req.json<Record<string, string | null>>();

	for (const [key, value] of Object.entries(body)) {
		if (!CONFIG_KEYS.includes(key as (typeof CONFIG_KEYS)[number])) {
			return c.json({ error: `Unknown setting: ${key}` }, 400);
		}
		if (value !== null && typeof value !== "string") {
			return c.json({ error: `Setting ${key} must be a string or null.` }, 400);
		}

		// Validate specific settings
		if (key === "compression_base_url" && value !== null) {
			try {
				const url = new URL(value);
				if (url.protocol !== "https:" && url.protocol !== "http:") {
					return c.json({ error: "compression_base_url must use http or https." }, 400);
				}
			} catch {
				return c.json({ error: "compression_base_url must be a valid URL." }, 400);
			}
		}
		if (key === "memory_mode" && value !== null && value !== "simple" && value !== "full") {
			return c.json({ error: "memory_mode must be 'simple' or 'full'." }, 400);
		}
		if (key === "compression_mode" && value !== null && value !== "client" && value !== "server") {
			return c.json({ error: "compression_mode must be 'client' or 'server'." }, 400);
		}
		if (key === "compression_provider" && value !== null) {
			if (!["anthropic", "openrouter", "ollama"].includes(value)) {
				return c.json(
					{ error: "compression_provider must be 'anthropic', 'openrouter', or 'ollama'." },
					400,
				);
			}
		}
		if (key === "compression_batch_size" && value !== null) {
			const num = Number(value);
			if (!Number.isInteger(num) || num < 5 || num > 100) {
				return c.json(
					{ error: "compression_batch_size must be an integer between 5 and 100." },
					400,
				);
			}
		}
		if (key === "compression_interval_minutes" && value !== null) {
			const num = Number(value);
			if (!Number.isInteger(num) || num < 5 || num > 60) {
				return c.json(
					{ error: "compression_interval_minutes must be an integer between 5 and 60." },
					400,
				);
			}
		}
		if (key === "privacy_patterns" && value !== null) {
			const lines = value.split("\n").filter((l) => {
				const t = l.trim();
				return t && !t.startsWith("#");
			});
			for (const line of lines) {
				try {
					new RegExp(line.trim(), "gi");
				} catch {
					return c.json({ error: `Invalid regex pattern: ${line.trim()}` }, 400);
				}
			}
		}
		if (key === "session_context_count" && value !== null) {
			const num = Number(value);
			if (!Number.isInteger(num) || num < 1 || num > 20) {
				return c.json({ error: "session_context_count must be an integer between 1 and 20." }, 400);
			}
		}
		if (key === "dedup_threshold" && value !== null) {
			const num = Number(value);
			if (!Number.isFinite(num) || num < 0.5 || num > 1.0) {
				return c.json({ error: "dedup_threshold must be a number between 0.5 and 1.0." }, 400);
			}
		}
		if (
			(key === "ttl_default_session" ||
				key === "ttl_default_project" ||
				key === "ttl_default_workspace" ||
				key === "ttl_default_global" ||
				key === "ttl_max") &&
			value !== null
		) {
			const num = Number(value);
			if (!Number.isInteger(num) || num < 3600 || num > 31536000) {
				return c.json(
					{ error: `${key} must be an integer between 3600 (1 hour) and 31536000 (365 days).` },
					400,
				);
			}
		}

		if (value === null) {
			deleteConfig(key);
		} else {
			setConfig(key, value);
		}
	}

	// Reset cached compression provider when relevant settings change
	const compressionKeys = [
		"compression_provider",
		"compression_model",
		"compression_api_key",
		"compression_base_url",
	];
	if (Object.keys(body).some((k) => compressionKeys.includes(k))) {
		setCompressionProvider(null);
	}
	if ("privacy_patterns" in body) {
		resetPrivacyCache();
	}

	return c.json({ ok: true });
});

// --- Workspaces ---

const WORKSPACE_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,62}$/u;

function validateWorkspaceName(name: string): string | null {
	if (!WORKSPACE_NAME_RE.test(name)) {
		return "Name must be 1-63 characters: letters, numbers, hyphens, underscores, dots. Must start with a letter or number.";
	}
	return null;
}

admin.get("/workspaces", (c) => {
	const userId = c.get("userId");
	const isAdmin = c.get("role") === "admin";
	const workspaces = listWorkspaces(isAdmin ? undefined : userId);
	return c.json({ workspaces });
});

admin.post("/workspaces", async (c) => {
	const body = await c.req.json<{ name?: string }>();
	const name = body.name?.trim();
	if (!name) {
		return c.json({ error: "Name is required." }, 400);
	}
	const nameError = validateWorkspaceName(name);
	if (nameError) {
		return c.json({ error: nameError }, 400);
	}

	try {
		const id = createWorkspace(name, c.get("userId"));
		return c.json({ id, name }, 201);
	} catch {
		return c.json({ error: "Workspace name already exists." }, 409);
	}
});

admin.get("/workspaces/:id", (c) => {
	const userId = c.get("userId");
	const isAdmin = c.get("role") === "admin";
	const ws = isAdmin
		? getWorkspace(c.req.param("id"))
		: getWorkspaceForUser(c.req.param("id"), userId);

	if (!ws) return c.json({ error: "Not found." }, 404);

	const projects = listWorkspaceProjects(ws.id);
	return c.json({ ...ws, projects });
});

admin.put("/workspaces/:id", async (c) => {
	const userId = c.get("userId");
	const ws = getWorkspaceForUser(c.req.param("id"), userId);
	if (!ws) return c.json({ error: "Not found." }, 404);

	const body = await c.req.json<{ name?: string }>();
	const name = body.name?.trim();
	if (!name) {
		return c.json({ error: "Name is required." }, 400);
	}
	const nameError = validateWorkspaceName(name);
	if (nameError) {
		return c.json({ error: nameError }, 400);
	}

	if (!updateWorkspace(ws.id, name, userId)) {
		return c.json({ error: "Not found." }, 404);
	}
	return c.json({ ok: true });
});

admin.delete("/workspaces/:id", (c) => {
	const userId = c.get("userId");
	const ws = getWorkspaceForUser(c.req.param("id"), userId);
	if (!ws) return c.json({ error: "Not found." }, 404);

	const result = deleteWorkspace(ws.id);
	return c.json({
		id: ws.id,
		deleted: true,
		rescoped_memories: result.rescopedMemories,
	});
});

admin.post("/workspaces/:id/projects", async (c) => {
	const userId = c.get("userId");
	const ws = getWorkspaceForUser(c.req.param("id"), userId);
	if (!ws) return c.json({ error: "Not found." }, 404);

	const body = await c.req.json<{ git_remote?: string }>();
	const gitRemote = body.git_remote?.trim();
	if (!gitRemote) {
		return c.json({ error: "git_remote is required." }, 400);
	}

	const existing = getWorkspaceForProject(gitRemote);
	if (existing && existing.created_by !== userId) {
		return c.json({ error: "Project is assigned to another user's workspace." }, 409);
	}

	try {
		assignProjectToWorkspace(ws.id, gitRemote);
	} catch {
		return c.json({ error: "Project is already assigned to a workspace." }, 409);
	}
	return c.json({ workspace_id: ws.id, git_remote: gitRemote }, 201);
});

admin.delete("/workspaces/:id/projects/:remote", (c) => {
	const userId = c.get("userId");
	const ws = getWorkspaceForUser(c.req.param("id"), userId);
	if (!ws) return c.json({ error: "Not found." }, 404);

	const remote = decodeURIComponent(c.req.param("remote"));
	if (!removeProjectFromWorkspace(ws.id, remote)) {
		return c.json({ error: "Not found." }, 404);
	}
	return c.json({ git_remote: remote, deleted: true });
});

// --- User Settings (workspace auto-detect) ---

admin.get("/user-settings/workspace-auto-detect", (c) => {
	const value = getUserSetting(c.get("userId"), "workspace_auto_detect");
	return c.json({ enabled: value !== "false" });
});

admin.put("/user-settings/workspace-auto-detect", async (c) => {
	const body = await c.req.json<{ enabled?: boolean }>();
	if (typeof body.enabled !== "boolean") {
		return c.json({ error: "enabled must be a boolean." }, 400);
	}
	setUserSetting(c.get("userId"), "workspace_auto_detect", String(body.enabled));
	return c.json({ ok: true });
});

// --- Claude Code memory backfill ---

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

function parseClaudeMemoryFile(content: string): {
	name: string | null;
	description: string | null;
	type: string | null;
	body: string;
} | null {
	const match = content.match(FRONTMATTER_RE);
	if (!match) return null;

	const fm = match[1] ?? "";
	const body = match[2]?.trim() ?? "";
	if (!body) return null;

	const nameMatch = fm.match(/^name:\s*(.+)$/m);
	const descMatch = fm.match(/^description:\s*(.+)$/m);
	const typeMatch = fm.match(/^\s*type:\s*(.+)$/m);

	return {
		name: nameMatch?.[1]?.trim() ?? null,
		description: descMatch?.[1]?.trim() ?? null,
		type: typeMatch?.[1]?.trim() ?? null,
		body,
	};
}

function claudeTypeToMemoryType(type: string | null): string {
	if (!type) return "fact";
	const map: Record<string, string> = {
		user: "fact",
		feedback: "lesson",
		project: "fact",
		reference: "fact",
	};
	return map[type] ?? "fact";
}

admin.get("/backfill/claude-discover", (c) => {
	if (c.get("role") !== "admin") {
		return c.json({ error: "Forbidden." }, 403);
	}

	const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
	const claudeProjectsDir = join(homeDir, ".claude", "projects");

	if (!existsSync(claudeProjectsDir)) {
		return c.json({ claude_home: claudeProjectsDir, projects: [] });
	}

	const projects: Array<{
		path: string;
		name: string;
		memory_count: number;
		files: string[];
	}> = [];

	try {
		for (const entry of readdirSync(claudeProjectsDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const memoryDir = join(claudeProjectsDir, entry.name, "memory");
			if (!existsSync(memoryDir)) continue;

			const files = readdirSync(memoryDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
			if (files.length === 0) continue;

			const dirName = entry.name.replace(/^-/, "/").replaceAll("-", "/");

			projects.push({
				path: memoryDir,
				name: dirName,
				memory_count: files.length,
				files,
			});
		}
	} catch {
		return c.json({
			claude_home: claudeProjectsDir,
			projects: [],
			error: "Failed to read directory",
		});
	}

	projects.sort((a, b) => b.memory_count - a.memory_count);

	return c.json({ claude_home: claudeProjectsDir, projects });
});

admin.post("/backfill/claude-memories", async (c) => {
	if (c.get("role") !== "admin") {
		return c.json({ error: "Forbidden." }, 403);
	}

	const body = await c.req.json<{ path?: string; git_remote?: string }>();
	const memoryDir = body.path?.trim();
	if (!memoryDir) {
		return c.json(
			{ error: "path is required (e.g. ~/.claude/projects/-Users-me-code-myproject/memory)" },
			400,
		);
	}

	const resolvedPath = resolve(memoryDir);
	if (!existsSync(resolvedPath)) {
		return c.json({ error: `Directory not found: ${resolvedPath}` }, 404);
	}

	const apiKeys = listApiKeys(c.get("userId"));
	const apiKey = apiKeys.find((k) => k.is_active);
	if (!apiKey) {
		return c.json({ error: "No active API key found." }, 400);
	}

	const files = readdirSync(resolvedPath).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");

	const results: Array<{ file: string; status: string; id?: string; title?: string }> = [];

	for (const file of files) {
		const content = readFileSync(join(resolvedPath, file), "utf-8");
		const parsed = parseClaudeMemoryFile(content);
		if (!parsed) {
			results.push({ file, status: "skipped", title: "no frontmatter" });
			continue;
		}

		try {
			const result = await storeMemory({
				summary: parsed.body,
				apiKeyId: apiKey.id,
				apiKeyLabel: apiKey.label,
				userId: c.get("userId"),
				gitRemote: body.git_remote ?? null,
				scope: "project",
				memoryType: claudeTypeToMemoryType(parsed.type),
				title: parsed.description ?? parsed.name ?? basename(file, ".md"),
				metadata: {
					source: "claude_code_backfill",
					claude_name: parsed.name,
					claude_type: parsed.type,
					file: basename(file),
				},
			});

			if (isDuplicate(result)) {
				results.push({ file, status: "duplicate", id: result.existing_id });
			} else {
				results.push({ file, status: "imported", id: result.id, title: result.title ?? undefined });
			}
		} catch (err) {
			results.push({
				file,
				status: "error",
				title: err instanceof Error ? err.message : String(err),
			});
		}
	}

	const imported = results.filter((r) => r.status === "imported").length;
	const duplicates = results.filter((r) => r.status === "duplicate").length;
	const errors = results.filter((r) => r.status === "error").length;
	const skipped = results.filter((r) => r.status === "skipped").length;

	log.info(
		"Claude memory backfill: {imported} imported, {duplicates} duplicates, {errors} errors, {skipped} skipped",
		{
			imported,
			duplicates,
			errors,
			skipped,
		},
	);

	return c.json({ imported, duplicates, errors, skipped, results });
});

export { admin };
