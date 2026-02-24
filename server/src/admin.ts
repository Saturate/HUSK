import { Hono } from "hono";
import { jwtMiddleware } from "./auth.js";
import {
	countMemories,
	deleteMemory,
	getMemory,
	listDistinctGitRemotes,
	listDistinctScopes,
	listMemories,
} from "./db.js";
import { listApiKeys } from "./db.js";
import { getProvider } from "./embeddings.js";
import { deletePoint, searchMemories } from "./qdrant.js";

const admin = new Hono();

admin.use("*", jwtMiddleware);

// --- Stats ---

admin.get("/stats", (c) => {
	const memoryCount = countMemories();
	const keys = listApiKeys();
	const projects = listDistinctGitRemotes();
	const activeKeys = keys.filter((k) => k.is_active).length;

	return c.json({
		memories: memoryCount,
		keys: { total: keys.length, active: activeKeys },
		projects: projects.length,
	});
});

// --- Filters ---

admin.get("/filters", (c) => {
	const projects = listDistinctGitRemotes();
	const scopes = listDistinctScopes();
	return c.json({ projects, scopes });
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

	try {
		const vector = await getProvider().embed(query);
		const filter: { git_remote?: string; scope?: string } = {};
		if (body.git_remote) filter.git_remote = body.git_remote;
		if (body.scope) filter.scope = body.scope;

		const results = await searchMemories(
			vector,
			Object.keys(filter).length > 0 ? filter : undefined,
			limit,
		);

		// Enrich with full memory data from SQLite
		const memories = results.map((r) => {
			const memory = getMemory(r.id as string);
			return {
				score: r.score,
				...memory,
			};
		});

		return c.json({ results: memories });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Search failed.";
		return c.json({ error: message }, 502);
	}
});

// --- Memories ---

admin.get("/memories", (c) => {
	const gitRemote = c.req.query("git_remote");
	const scope = c.req.query("scope");
	const limit = Number(c.req.query("limit")) || 50;
	const offset = Number(c.req.query("offset")) || 0;

	const memories = listMemories({ gitRemote, scope, limit, offset });
	const total = countMemories({ gitRemote, scope });

	return c.json({ memories, total });
});

admin.delete("/memories/:id", async (c) => {
	const id = c.req.param("id");
	const memory = getMemory(id);

	if (!memory) {
		return c.json({ error: "Memory not found." }, 404);
	}

	deleteMemory(id);

	try {
		await deletePoint(id);
	} catch {
		// Qdrant might be down — SQLite deletion is still valid
	}

	return c.json({ id, deleted: true });
});

export { admin };
