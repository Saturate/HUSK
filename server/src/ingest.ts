import { Hono } from "hono";
import { bearerKeyMiddleware } from "./auth.js";
import { createMemory } from "./db.js";
import { getProvider } from "./embeddings.js";
import { upsertMemory } from "./qdrant.js";

const VALID_SCOPES = ["session", "project", "global"] as const;
type Scope = (typeof VALID_SCOPES)[number];

interface IngestBody {
	summary?: string;
	git_remote?: string;
	scope?: string;
	metadata?: Record<string, unknown>;
}

const ingest = new Hono();

ingest.use("*", bearerKeyMiddleware);

ingest.post("/", async (c) => {
	const body = await c.req.json<IngestBody>();

	const summary = body.summary?.trim();
	if (!summary) {
		return c.json({ error: "Summary is required." }, 400);
	}

	const scope = (body.scope ?? "session") as Scope;
	if (!VALID_SCOPES.includes(scope)) {
		return c.json({ error: `Invalid scope. Must be one of: ${VALID_SCOPES.join(", ")}` }, 400);
	}

	const gitRemote = body.git_remote?.trim() || null;
	const metadata = body.metadata ? JSON.stringify(body.metadata) : null;

	const apiKey = c.get("apiKey") as { id: string; label: string };

	let vector: number[];
	try {
		vector = await getProvider().embed(summary);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		return c.json({ error: `Embedding provider error: ${message}` }, 502);
	}

	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();

	createMemory({
		id,
		apiKeyId: apiKey.id,
		gitRemote: gitRemote,
		scope,
		summary,
		metadata,
	});

	try {
		await upsertMemory(id, vector, {
			memory_id: id,
			git_remote: gitRemote,
			scope,
			api_key_label: apiKey.label,
			created_at: createdAt,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		return c.json({ error: `Vector storage error: ${message}` }, 502);
	}

	return c.json({ id, summary, scope, git_remote: gitRemote, created_at: createdAt }, 201);
});

export { ingest };
