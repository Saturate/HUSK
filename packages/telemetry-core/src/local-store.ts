import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { SpanData, TraceData, TraceTotals } from "./types.js";

let db: Database | null = null;

function getDefaultPath(): string {
	return join(homedir(), ".husk", "telemetry.db");
}

export function getLocalDb(path?: string): Database {
	if (db) return db;

	const dbPath = path ?? process.env.HUSK_LOCAL_TELEMETRY_DB ?? getDefaultPath();
	mkdirSync(dirname(dbPath), { recursive: true });

	db = new Database(dbPath);
	db.run("PRAGMA journal_mode = WAL");
	db.run("PRAGMA foreign_keys = ON");

	db.run(`
		CREATE TABLE IF NOT EXISTS traces (
			id TEXT PRIMARY KEY,
			trace_id TEXT NOT NULL UNIQUE,
			project TEXT,
			git_branch TEXT,
			model TEXT,
			agent_type TEXT,
			status TEXT NOT NULL DEFAULT 'active',
			started_at TEXT NOT NULL,
			ended_at TEXT,
			total_input_tokens INTEGER DEFAULT 0,
			total_output_tokens INTEGER DEFAULT 0,
			total_cache_read_tokens INTEGER DEFAULT 0,
			total_cache_create_tokens INTEGER DEFAULT 0,
			total_cost_usd REAL DEFAULT 0,
			total_turns INTEGER DEFAULT 0,
			total_tool_calls INTEGER DEFAULT 0,
			total_tool_failures INTEGER DEFAULT 0,
			synced INTEGER NOT NULL DEFAULT 0
		)
	`);
	db.run("CREATE INDEX IF NOT EXISTS idx_local_traces_started ON traces(started_at)");
	db.run("CREATE INDEX IF NOT EXISTS idx_local_traces_synced ON traces(synced) WHERE synced = 0");

	db.run(`
		CREATE TABLE IF NOT EXISTS spans (
			id TEXT PRIMARY KEY,
			trace_id TEXT NOT NULL,
			span_id TEXT NOT NULL,
			parent_span_id TEXT,
			name TEXT NOT NULL,
			kind TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'ok',
			started_at TEXT NOT NULL,
			ended_at TEXT,
			duration_ms INTEGER,
			tool_name TEXT,
			input_summary TEXT,
			exit_code INTEGER,
			output_size INTEGER,
			model TEXT,
			input_tokens INTEGER,
			output_tokens INTEGER,
			cache_read_tokens INTEGER,
			cache_create_tokens INTEGER,
			cost_usd REAL,
			attributes TEXT,
			synced INTEGER NOT NULL DEFAULT 0
		)
	`);
	db.run("CREATE INDEX IF NOT EXISTS idx_local_spans_trace ON spans(trace_id)");
	db.run("CREATE INDEX IF NOT EXISTS idx_local_spans_synced ON spans(synced) WHERE synced = 0");
	db.run("CREATE INDEX IF NOT EXISTS idx_local_spans_started ON spans(started_at)");

	return db;
}

export function closeLocalDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}

export function insertTrace(trace: TraceData): void {
	const local = getLocalDb();
	local
		.query(
			`INSERT OR IGNORE INTO traces (id, trace_id, project, git_branch, model, agent_type, started_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			crypto.randomUUID(),
			trace.traceId,
			trace.project,
			trace.gitBranch,
			trace.model,
			trace.agentType,
			trace.startedAt,
		);
}

export function endTrace(traceId: string, totals: TraceTotals): void {
	const local = getLocalDb();
	local
		.query(
			`UPDATE traces SET
				status = 'ended',
				ended_at = datetime('now'),
				total_input_tokens = ?,
				total_output_tokens = ?,
				total_cache_read_tokens = ?,
				total_cache_create_tokens = ?,
				total_cost_usd = ?,
				total_turns = ?,
				total_tool_calls = ?,
				total_tool_failures = ?,
				synced = 0
			 WHERE trace_id = ?`,
		)
		.run(
			totals.totalInputTokens,
			totals.totalOutputTokens,
			totals.totalCacheReadTokens,
			totals.totalCacheCreateTokens,
			totals.totalCostUsd,
			totals.totalTurns,
			totals.totalToolCalls,
			totals.totalToolFailures,
			traceId,
		);
}

export function insertSpan(span: SpanData): void {
	const local = getLocalDb();
	local
		.query(
			`INSERT INTO spans (id, trace_id, span_id, parent_span_id, name, kind, status,
				started_at, ended_at, duration_ms, tool_name, input_summary, exit_code, output_size,
				model, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_usd, attributes)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			crypto.randomUUID(),
			span.traceId,
			span.spanId,
			span.parentSpanId,
			span.name,
			span.kind,
			span.status,
			span.startedAt,
			span.endedAt,
			span.durationMs,
			span.toolName,
			span.inputSummary,
			span.exitCode,
			span.outputSize,
			span.model,
			span.inputTokens,
			span.outputTokens,
			span.cacheReadTokens,
			span.cacheCreateTokens,
			span.costUsd,
			span.attributes ? JSON.stringify(span.attributes) : null,
		);
}

export function getUnsyncedTraces(limit = 100): Array<{ trace_id: string }> {
	const local = getLocalDb();
	return local
		.query<{ trace_id: string }, [number]>("SELECT * FROM traces WHERE synced = 0 LIMIT ?")
		.all(limit);
}

export function getUnsyncedSpans(limit = 100): SpanData[] {
	const rows = getLocalDb()
		.query<Record<string, unknown>, [number]>("SELECT * FROM spans WHERE synced = 0 LIMIT ?")
		.all(limit);

	return rows.map((r) => ({
		traceId: r.trace_id as string,
		spanId: r.span_id as string,
		parentSpanId: (r.parent_span_id as string) ?? null,
		name: r.name as string,
		kind: r.kind as SpanData["kind"],
		status: (r.status as "ok" | "error") ?? "ok",
		startedAt: r.started_at as string,
		endedAt: (r.ended_at as string) ?? null,
		durationMs: (r.duration_ms as number) ?? null,
		toolName: (r.tool_name as string) ?? null,
		inputSummary: (r.input_summary as string) ?? null,
		exitCode: (r.exit_code as number) ?? null,
		outputSize: (r.output_size as number) ?? null,
		model: (r.model as string) ?? null,
		inputTokens: (r.input_tokens as number) ?? null,
		outputTokens: (r.output_tokens as number) ?? null,
		cacheReadTokens: (r.cache_read_tokens as number) ?? null,
		cacheCreateTokens: (r.cache_create_tokens as number) ?? null,
		costUsd: (r.cost_usd as number) ?? null,
		attributes: r.attributes ? (JSON.parse(r.attributes as string) as Record<string, unknown>) : null,
	}));
}

export function markSpansSynced(spanIds: string[]): void {
	if (spanIds.length === 0) return;
	const local = getLocalDb();
	const placeholders = spanIds.map(() => "?").join(",");
	local.query(`UPDATE spans SET synced = 1 WHERE span_id IN (${placeholders})`).run(...spanIds);
}

export function markTracesSynced(traceIds: string[]): void {
	if (traceIds.length === 0) return;
	const local = getLocalDb();
	const placeholders = traceIds.map(() => "?").join(",");
	local.query(`UPDATE traces SET synced = 1 WHERE trace_id IN (${placeholders})`).run(...traceIds);
}
