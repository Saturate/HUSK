import { getDb } from "./db.js";
import type {
	CreateSpanParams,
	DailyCost,
	DateRangeOpts,
	ModelCost,
	ProjectCost,
	SpanKind,
	SpanRow,
	SpanUpdates,
	StartTraceParams,
	TelemetryProvider,
	ToolStats,
	TraceQueryOpts,
	TraceRow,
	TraceTotals,
} from "./telemetry.js";

export class SqliteTelemetryProvider implements TelemetryProvider {
	readonly name = "sqlite";

	async init(): Promise<void> {
		// Tables created in db.ts initDb
	}

	// --- Ingest ---

	async startTrace(params: StartTraceParams): Promise<TraceRow> {
		const db = getDb();
		const id = crypto.randomUUID();

		db.query(
			`INSERT INTO traces (id, trace_id, api_key_id, project, git_branch, model, agent_type, started_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			id,
			params.traceId,
			params.apiKeyId,
			params.project ?? null,
			params.gitBranch ?? null,
			params.model ?? null,
			params.agentType ?? null,
			params.startedAt ?? new Date().toISOString(),
		);

		const row = db.query<TraceRow, [string]>("SELECT * FROM traces WHERE id = ?").get(id);
		if (!row) throw new Error("Failed to create trace");
		return row;
	}

	async endTrace(traceId: string, totals: TraceTotals): Promise<void> {
		const db = getDb();
		db.query(
			`UPDATE traces SET
				status = 'ended',
				ended_at = datetime('now'),
				total_input_tokens = COALESCE(?, total_input_tokens),
				total_output_tokens = COALESCE(?, total_output_tokens),
				total_cache_read_tokens = COALESCE(?, total_cache_read_tokens),
				total_cache_create_tokens = COALESCE(?, total_cache_create_tokens),
				total_cost_usd = COALESCE(?, total_cost_usd),
				total_turns = COALESCE(?, total_turns),
				total_tool_calls = COALESCE(?, total_tool_calls),
				total_tool_failures = COALESCE(?, total_tool_failures)
			 WHERE trace_id = ?`,
		).run(
			totals.totalInputTokens ?? null,
			totals.totalOutputTokens ?? null,
			totals.totalCacheReadTokens ?? null,
			totals.totalCacheCreateTokens ?? null,
			totals.totalCostUsd ?? null,
			totals.totalTurns ?? null,
			totals.totalToolCalls ?? null,
			totals.totalToolFailures ?? null,
			traceId,
		);

		// Update pre-aggregated daily metrics
		const trace = await this.getTrace(traceId);
		if (trace) {
			this.updateDailyMetrics(trace);
		}
	}

	private updateDailyMetrics(trace: TraceRow): void {
		const db = getDb();
		const date = trace.started_at.slice(0, 10); // YYYY-MM-DD
		const project = trace.project ?? "(unknown)";
		const model = trace.model ?? "(unknown)";

		const metrics: Array<[string, number]> = [
			["cost", trace.total_cost_usd],
			["tokens_in", trace.total_input_tokens],
			["tokens_out", trace.total_output_tokens],
			["sessions", 1],
			["turns", trace.total_turns],
			["tool_calls", trace.total_tool_calls],
			["tool_failures", trace.total_tool_failures],
		];

		const stmt = db.query(
			`INSERT INTO telemetry_metrics (id, date, api_key_id, project, model, metric_name, metric_value)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(date, api_key_id, project, model, metric_name)
			 DO UPDATE SET metric_value = metric_value + excluded.metric_value`,
		);

		for (const [name, value] of metrics) {
			if (value === 0 && name !== "sessions") continue;
			stmt.run(crypto.randomUUID(), date, trace.api_key_id, project, model, name, value);
		}
	}

	async createSpan(params: CreateSpanParams): Promise<SpanRow> {
		const db = getDb();
		const id = crypto.randomUUID();

		db.query(
			`INSERT INTO spans (id, trace_id, span_id, parent_span_id, name, kind, started_at, ended_at, duration_ms,
				tool_name, input_summary, exit_code, output_size, model,
				input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_usd, attributes, linked_trace_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			id,
			params.traceId,
			params.spanId,
			params.parentSpanId ?? null,
			params.name,
			params.kind,
			params.startedAt,
			params.endedAt ?? null,
			params.durationMs ?? null,
			params.toolName ?? null,
			params.inputSummary ?? null,
			params.exitCode ?? null,
			params.outputSize ?? null,
			params.model ?? null,
			params.inputTokens ?? null,
			params.outputTokens ?? null,
			params.cacheReadTokens ?? null,
			params.cacheCreateTokens ?? null,
			params.costUsd ?? null,
			params.attributes ? JSON.stringify(params.attributes) : null,
			params.linkedTraceId ?? null,
		);

		const row = db.query<SpanRow, [string]>("SELECT * FROM spans WHERE id = ?").get(id);
		if (!row) throw new Error("Failed to create span");
		return row;
	}

	async updateSpan(spanId: string, updates: SpanUpdates): Promise<void> {
		const db = getDb();
		const sets: string[] = [];
		const values: (string | number | null)[] = [];

		if (updates.endedAt !== undefined) {
			sets.push("ended_at = ?");
			values.push(updates.endedAt);
		}
		if (updates.durationMs !== undefined) {
			sets.push("duration_ms = ?");
			values.push(updates.durationMs);
		}
		if (updates.status !== undefined) {
			sets.push("status = ?");
			values.push(updates.status);
		}
		if (updates.exitCode !== undefined) {
			sets.push("exit_code = ?");
			values.push(updates.exitCode);
		}
		if (updates.outputSize !== undefined) {
			sets.push("output_size = ?");
			values.push(updates.outputSize);
		}
		if (updates.inputTokens !== undefined) {
			sets.push("input_tokens = ?");
			values.push(updates.inputTokens);
		}
		if (updates.outputTokens !== undefined) {
			sets.push("output_tokens = ?");
			values.push(updates.outputTokens);
		}
		if (updates.cacheReadTokens !== undefined) {
			sets.push("cache_read_tokens = ?");
			values.push(updates.cacheReadTokens);
		}
		if (updates.cacheCreateTokens !== undefined) {
			sets.push("cache_create_tokens = ?");
			values.push(updates.cacheCreateTokens);
		}
		if (updates.costUsd !== undefined) {
			sets.push("cost_usd = ?");
			values.push(updates.costUsd);
		}
		if (updates.attributes !== undefined) {
			sets.push("attributes = ?");
			values.push(JSON.stringify(updates.attributes));
		}

		if (sets.length === 0) return;

		values.push(spanId);
		db.query(`UPDATE spans SET ${sets.join(", ")} WHERE span_id = ?`).run(...values);
	}

	// --- Query ---

	async getTrace(traceId: string): Promise<TraceRow | null> {
		return (
			getDb().query<TraceRow, [string]>("SELECT * FROM traces WHERE trace_id = ?").get(traceId) ??
			null
		);
	}

	async listTraces(opts: TraceQueryOpts): Promise<TraceRow[]> {
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (opts.from) {
			conditions.push("started_at >= ?");
			params.push(opts.from);
		}
		if (opts.to) {
			conditions.push("started_at <= ?");
			params.push(opts.to);
		}
		if (opts.apiKeyId) {
			conditions.push("api_key_id = ?");
			params.push(opts.apiKeyId);
		}
		if (opts.project) {
			conditions.push("project = ?");
			params.push(opts.project);
		}
		if (opts.status) {
			conditions.push("status = ?");
			params.push(opts.status);
		}
		if (opts.model) {
			conditions.push("model = ?");
			params.push(opts.model);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const limit = Math.min(opts.limit ?? 50, 200);
		const offset = opts.offset ?? 0;
		params.push(limit, offset);

		return getDb()
			.query<TraceRow, (string | number)[]>(
				`SELECT * FROM traces ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
			)
			.all(...params);
	}

	async getSpansForTrace(traceId: string, kind?: SpanKind): Promise<SpanRow[]> {
		if (kind) {
			return getDb()
				.query<SpanRow, [string, string]>(
					"SELECT * FROM spans WHERE trace_id = ? AND kind = ? ORDER BY started_at ASC",
				)
				.all(traceId, kind);
		}
		return getDb()
			.query<SpanRow, [string]>("SELECT * FROM spans WHERE trace_id = ? ORDER BY started_at ASC")
			.all(traceId);
	}

	// --- Aggregation ---

	async costByProject(opts: DateRangeOpts): Promise<ProjectCost[]> {
		const { where, params } = this.buildDateFilter(opts, "started_at");
		return getDb()
			.query<ProjectCost, (string | number)[]>(
				`SELECT
					COALESCE(project, '(unknown)') as project,
					SUM(total_cost_usd) as total_cost_usd,
					COUNT(*) as session_count,
					SUM(total_turns) as total_turns,
					MAX(started_at) as last_active
				 FROM traces
				 ${where}
				 GROUP BY project
				 ORDER BY total_cost_usd DESC`,
			)
			.all(...params);
	}

	async costByModel(opts: DateRangeOpts): Promise<ModelCost[]> {
		const { where, params } = this.buildDateFilter(opts, "started_at");
		return getDb()
			.query<ModelCost, (string | number)[]>(
				`SELECT
					COALESCE(model, '(unknown)') as model,
					SUM(total_cost_usd) as total_cost_usd,
					SUM(total_input_tokens) as total_input_tokens,
					SUM(total_output_tokens) as total_output_tokens,
					COUNT(*) as session_count
				 FROM traces
				 ${where}
				 GROUP BY model
				 ORDER BY total_cost_usd DESC`,
			)
			.all(...params);
	}

	async costByDay(opts: DateRangeOpts): Promise<DailyCost[]> {
		const { where, params } = this.buildDateFilter(opts, "started_at");
		return getDb()
			.query<DailyCost, (string | number)[]>(
				`SELECT
					date(started_at) as date,
					SUM(total_cost_usd) as total_cost_usd,
					COUNT(*) as session_count,
					SUM(total_turns) as total_turns
				 FROM traces
				 ${where}
				 GROUP BY date(started_at)
				 ORDER BY date ASC`,
			)
			.all(...params);
	}

	async toolUsageStats(opts: DateRangeOpts): Promise<ToolStats[]> {
		const { where, params } = this.buildDateFilter(opts, "started_at");
		const kindCondition = where ? " AND kind = 'tool'" : "WHERE kind = 'tool'";

		return getDb()
			.query<ToolStats, (string | number)[]>(
				`SELECT
					tool_name,
					COUNT(*) as call_count,
					SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failure_count,
					ROUND(CAST(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS REAL) / COUNT(*), 4) as failure_rate,
					ROUND(AVG(duration_ms), 1) as avg_duration_ms,
					COALESCE(duration_ms, 0) as p95_duration_ms
				 FROM spans
				 ${where}${kindCondition}
				 AND tool_name IS NOT NULL
				 GROUP BY tool_name
				 ORDER BY call_count DESC`,
			)
			.all(...params);
	}

	async modelDetails(opts: DateRangeOpts): Promise<import("./telemetry.js").ModelDetail[]> {
		const { where, params } = this.buildDateFilter(opts, "started_at");
		const havingClause = where ? " HAVING SUM(total_turns) > 0" : "HAVING SUM(total_turns) > 0";
		return getDb()
			.query<import("./telemetry.js").ModelDetail, (string | number)[]>(
				`SELECT
					COALESCE(model, '(unknown)') as model,
					COUNT(*) as session_count,
					SUM(total_turns) as total_turns,
					SUM(total_input_tokens) as total_input_tokens,
					SUM(total_output_tokens) as total_output_tokens,
					SUM(total_cache_read_tokens) as total_cache_read_tokens,
					SUM(total_cache_create_tokens) as total_cache_create_tokens,
					SUM(total_cost_usd) as total_cost_usd,
					ROUND(CAST(SUM(total_output_tokens) AS REAL) / SUM(total_turns), 0) as avg_output_per_turn,
					ROUND(CAST(SUM(total_input_tokens) AS REAL) / SUM(total_turns), 0) as avg_input_per_turn,
					ROUND(SUM(total_cost_usd) / SUM(total_turns), 4) as avg_cost_per_turn,
					ROUND(CAST(SUM(total_cache_read_tokens) AS REAL) / NULLIF(SUM(total_cache_read_tokens) + SUM(total_cache_create_tokens) + SUM(total_input_tokens), 0), 4) as cache_hit_rate
				 FROM traces
				 ${where}
				 GROUP BY model
				 ${havingClause}
				 ORDER BY total_cost_usd DESC`,
			)
			.all(...params);
	}

	async healthy(): Promise<boolean> {
		try {
			getDb().query("SELECT 1 FROM traces LIMIT 1").get();
			return true;
		} catch {
			return false;
		}
	}

	// --- Helpers ---

	private buildDateFilter(
		opts: DateRangeOpts,
		column: string,
	): { where: string; params: (string | number)[] } {
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (opts.from) {
			conditions.push(`${column} >= ?`);
			params.push(opts.from);
		}
		if (opts.to) {
			conditions.push(`${column} <= ?`);
			params.push(opts.to);
		}
		if (opts.apiKeyId) {
			conditions.push("api_key_id = ?");
			params.push(opts.apiKeyId);
		}
		if (opts.project) {
			conditions.push("project = ?");
			params.push(opts.project);
		}

		return {
			where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
			params,
		};
	}
}
