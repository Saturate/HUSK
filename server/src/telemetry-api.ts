import { getLogger } from "@logtape/logtape";
import { Hono } from "hono";
import { bearerKeyMiddleware, jwtMiddleware } from "./auth.js";
import type { AppEnv } from "./env.js";
import { scanRecentTraces, scanTrace, scanLogFiles } from "./secret-scanner.js";
import { getTelemetryProviderOrNull } from "./telemetry.js";
import { compressTraceIfReady } from "./trace-compression-listener.js";

const log = getLogger(["husk", "telemetry-api"]);

export const telemetryApi = new Hono<AppEnv>();

// --- Ingest endpoints (Bearer key auth, used by husk-agent) ---

const ingestApi = new Hono<AppEnv>();
ingestApi.use("*", bearerKeyMiddleware);

ingestApi.post("/traces", async (c) => {
	const provider = getTelemetryProviderOrNull();
	if (!provider) return c.json({ error: "Telemetry not configured" }, 503);

	const body = await c.req.json<{
		trace_id: string;
		project?: string;
		git_branch?: string;
		model?: string;
		agent_type?: string;
		started_at?: string;
		// If action is "end", this ends an existing trace
		action?: "start" | "end";
		totals?: {
			total_input_tokens?: number;
			total_output_tokens?: number;
			total_cache_read_tokens?: number;
			total_cache_create_tokens?: number;
			total_cost_usd?: number;
			total_turns?: number;
			total_tool_calls?: number;
			total_tool_failures?: number;
		};
	}>();

	if (!body.trace_id) {
		return c.json({ error: "trace_id is required" }, 400);
	}

	if (body.action === "end") {
		await provider.endTrace(body.trace_id, {
			totalInputTokens: body.totals?.total_input_tokens,
			totalOutputTokens: body.totals?.total_output_tokens,
			totalCacheReadTokens: body.totals?.total_cache_read_tokens,
			totalCacheCreateTokens: body.totals?.total_cache_create_tokens,
			totalCostUsd: body.totals?.total_cost_usd,
			totalTurns: body.totals?.total_turns,
			totalToolCalls: body.totals?.total_tool_calls,
			totalToolFailures: body.totals?.total_tool_failures,
		});
		// Fire-and-forget trace compression
		compressTraceIfReady(body.trace_id).catch(() => {});
		return c.json({ ok: true });
	}

	const trace = await provider.startTrace({
		traceId: body.trace_id,
		apiKeyId: c.get("apiKey").id,
		project: body.project,
		gitBranch: body.git_branch,
		model: body.model,
		agentType: body.agent_type,
		startedAt: body.started_at,
	});

	return c.json({ trace_id: trace.trace_id, id: trace.id }, 201);
});

ingestApi.post("/spans", async (c) => {
	const provider = getTelemetryProviderOrNull();
	if (!provider) return c.json({ error: "Telemetry not configured" }, 503);

	const body = await c.req.json<{
		spans: Array<{
			trace_id: string;
			span_id: string;
			parent_span_id?: string;
			name: string;
			kind: string;
			started_at: string;
			ended_at?: string;
			duration_ms?: number;
			status?: string;
			tool_name?: string;
			input_summary?: string;
			exit_code?: number;
			output_size?: number;
			model?: string;
			input_tokens?: number;
			output_tokens?: number;
			cache_read_tokens?: number;
			cache_create_tokens?: number;
			cost_usd?: number;
			attributes?: Record<string, unknown>;
		}>;
	}>();

	if (!body.spans?.length) {
		return c.json({ error: "spans array is required" }, 400);
	}

	const created: string[] = [];
	for (const s of body.spans) {
		if (!s.trace_id || !s.span_id || !s.name || !s.kind || !s.started_at) {
			log.warn("Skipping span with missing required fields: {name}", { name: s.name ?? "(no name)" });
			continue;
		}

		const span = await provider.createSpan({
			traceId: s.trace_id,
			spanId: s.span_id,
			parentSpanId: s.parent_span_id,
			name: s.name,
			kind: s.kind as Parameters<typeof provider.createSpan>[0]["kind"],
			startedAt: s.started_at,
			endedAt: s.ended_at,
			durationMs: s.duration_ms,
			toolName: s.tool_name,
			inputSummary: s.input_summary,
			exitCode: s.exit_code,
			outputSize: s.output_size,
			model: s.model,
			inputTokens: s.input_tokens,
			outputTokens: s.output_tokens,
			cacheReadTokens: s.cache_read_tokens,
			cacheCreateTokens: s.cache_create_tokens,
			costUsd: s.cost_usd,
			attributes: s.attributes,
		});

		if (s.status === "error") {
			await provider.updateSpan(s.span_id, { status: "error" });
		}

		created.push(span.id);
	}

	return c.json({ created: created.length }, 201);
});

ingestApi.post("/spans/:spanId/end", async (c) => {
	const provider = getTelemetryProviderOrNull();
	if (!provider) return c.json({ error: "Telemetry not configured" }, 503);

	const spanId = c.req.param("spanId");
	const body = await c.req.json<{
		ended_at?: string;
		duration_ms?: number;
		status?: string;
		exit_code?: number;
		output_size?: number;
		input_tokens?: number;
		output_tokens?: number;
		cache_read_tokens?: number;
		cache_create_tokens?: number;
		cost_usd?: number;
		attributes?: Record<string, unknown>;
	}>();

	await provider.updateSpan(spanId, {
		endedAt: body.ended_at ?? new Date().toISOString(),
		durationMs: body.duration_ms,
		status: body.status,
		exitCode: body.exit_code,
		outputSize: body.output_size,
		inputTokens: body.input_tokens,
		outputTokens: body.output_tokens,
		cacheReadTokens: body.cache_read_tokens,
		cacheCreateTokens: body.cache_create_tokens,
		costUsd: body.cost_usd,
		attributes: body.attributes,
	});

	return c.json({ ok: true });
});

// --- Query endpoints (JWT auth, used by frontend) ---

const queryApi = new Hono<AppEnv>();
queryApi.use("*", jwtMiddleware);

queryApi.get("/stats/overview", async (c) => {
	const provider = getTelemetryProviderOrNull();
	if (!provider) return c.json({ error: "Telemetry not configured" }, 503);

	const today = new Date().toISOString().slice(0, 10);
	const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
	const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

	const [todayCost, weekCost, monthCost] = await Promise.all([
		provider.costByDay({ from: today }),
		provider.costByDay({ from: weekAgo }),
		provider.costByDay({ from: monthAgo }),
	]);

	const sum = (rows: typeof todayCost) =>
		rows.reduce(
			(acc, r) => ({
				cost: acc.cost + r.total_cost_usd,
				sessions: acc.sessions + r.session_count,
				turns: acc.turns + r.total_turns,
			}),
			{ cost: 0, sessions: 0, turns: 0 },
		);

	return c.json({
		today: sum(todayCost),
		week: sum(weekCost),
		month: sum(monthCost),
	});
});

queryApi.get("/stats/projects", async (c) => {
	const provider = getTelemetryProviderOrNull();
	if (!provider) return c.json({ error: "Telemetry not configured" }, 503);

	const from = c.req.query("from");
	const to = c.req.query("to");
	return c.json(await provider.costByProject({ from: from ?? undefined, to: to ?? undefined }));
});

queryApi.get("/stats/models", async (c) => {
	const provider = getTelemetryProviderOrNull();
	if (!provider) return c.json({ error: "Telemetry not configured" }, 503);

	const from = c.req.query("from");
	const to = c.req.query("to");
	return c.json(await provider.costByModel({ from: from ?? undefined, to: to ?? undefined }));
});

queryApi.get("/stats/tools", async (c) => {
	const provider = getTelemetryProviderOrNull();
	if (!provider) return c.json({ error: "Telemetry not configured" }, 503);

	const from = c.req.query("from");
	const to = c.req.query("to");
	return c.json(await provider.toolUsageStats({ from: from ?? undefined, to: to ?? undefined }));
});

queryApi.get("/stats/models/detail", async (c) => {
	const provider = getTelemetryProviderOrNull();
	if (!provider) return c.json({ error: "Telemetry not configured" }, 503);

	const from = c.req.query("from");
	const to = c.req.query("to");
	return c.json(await provider.modelDetails({ from: from ?? undefined, to: to ?? undefined }));
});

queryApi.get("/stats/daily", async (c) => {
	const provider = getTelemetryProviderOrNull();
	if (!provider) return c.json({ error: "Telemetry not configured" }, 503);

	const from = c.req.query("from");
	const to = c.req.query("to");
	return c.json(await provider.costByDay({ from: from ?? undefined, to: to ?? undefined }));
});

queryApi.get("/traces", async (c) => {
	const provider = getTelemetryProviderOrNull();
	if (!provider) return c.json({ error: "Telemetry not configured" }, 503);

	return c.json(
		await provider.listTraces({
			from: c.req.query("from") ?? undefined,
			to: c.req.query("to") ?? undefined,
			project: c.req.query("project") ?? undefined,
			model: c.req.query("model") ?? undefined,
			status: c.req.query("status") ?? undefined,
			limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
			offset: c.req.query("offset") ? Number(c.req.query("offset")) : undefined,
		}),
	);
});

queryApi.get("/traces/:traceId", async (c) => {
	const provider = getTelemetryProviderOrNull();
	if (!provider) return c.json({ error: "Telemetry not configured" }, 503);

	const traceId = c.req.param("traceId");
	const trace = await provider.getTrace(traceId);
	if (!trace) return c.json({ error: "Trace not found" }, 404);

	const spans = await provider.getSpansForTrace(traceId);
	return c.json({ trace, spans });
});

queryApi.get("/secrets/scan", async (c) => {
	const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 50;
	const results = await scanRecentTraces(limit);
	return c.json(results);
});

queryApi.get("/secrets/scan/logs", async (c) => {
	const results = await scanLogFiles();
	return c.json(results);
});

queryApi.get("/secrets/scan/:traceId", async (c) => {
	const traceId = c.req.param("traceId");
	const findings = await scanTrace(traceId);
	return c.json({ trace_id: traceId, findings });
});

// Mount both sub-routers
telemetryApi.route("/ingest", ingestApi);
telemetryApi.route("/", queryApi);
