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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- postgres.js types loaded dynamically
type Sql = any;

export class PostgresTelemetryProvider implements TelemetryProvider {
	readonly name = "postgres";
	private sql!: Sql;

	async init(): Promise<void> {
		const url = process.env.HUSK_TELEMETRY_URL;
		if (!url) throw new Error("HUSK_TELEMETRY_URL is required for postgres telemetry backend");

		// Dynamic import — postgres package must be installed: bun add postgres
		// @ts-expect-error -- postgres is an optional peer dependency, only needed when telemetry.backend = "postgres"
		const mod = await import("postgres");
		const postgres = mod.default ?? mod;
		this.sql = postgres(url);

		await this.sql`SELECT 1`;
		await this.createTables();
	}

	private async createTables(): Promise<void> {
		await this.sql`
			CREATE TABLE IF NOT EXISTS traces (
				id TEXT PRIMARY KEY,
				trace_id TEXT NOT NULL UNIQUE,
				api_key_id TEXT NOT NULL,
				project TEXT,
				git_branch TEXT,
				model TEXT,
				agent_type TEXT,
				status TEXT NOT NULL DEFAULT 'active',
				started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				ended_at TIMESTAMPTZ,
				total_input_tokens BIGINT DEFAULT 0,
				total_output_tokens BIGINT DEFAULT 0,
				total_cache_read_tokens BIGINT DEFAULT 0,
				total_cache_create_tokens BIGINT DEFAULT 0,
				total_cost_usd DOUBLE PRECISION DEFAULT 0,
				total_turns INTEGER DEFAULT 0,
				total_tool_calls INTEGER DEFAULT 0,
				total_tool_failures INTEGER DEFAULT 0,
				summary TEXT,
				last_compressed_at TIMESTAMPTZ
			)
		`;
		await this.sql`CREATE INDEX IF NOT EXISTS idx_traces_api_key ON traces(api_key_id)`;
		await this.sql`CREATE INDEX IF NOT EXISTS idx_traces_project ON traces(project)`;
		await this.sql`CREATE INDEX IF NOT EXISTS idx_traces_started ON traces(started_at)`;

		await this.sql`
			CREATE TABLE IF NOT EXISTS spans (
				id TEXT PRIMARY KEY,
				trace_id TEXT NOT NULL REFERENCES traces(trace_id),
				span_id TEXT NOT NULL,
				parent_span_id TEXT,
				name TEXT NOT NULL,
				kind TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'ok',
				started_at TIMESTAMPTZ NOT NULL,
				ended_at TIMESTAMPTZ,
				duration_ms INTEGER,
				tool_name TEXT,
				input_summary TEXT,
				exit_code INTEGER,
				output_size INTEGER,
				model TEXT,
				input_tokens BIGINT,
				output_tokens BIGINT,
				cache_read_tokens BIGINT,
				cache_create_tokens BIGINT,
				cost_usd DOUBLE PRECISION,
				attributes JSONB,
				linked_trace_id TEXT
			)
		`;
		await this.sql`CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id)`;
		await this.sql`CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans(parent_span_id)`;
		await this.sql`CREATE INDEX IF NOT EXISTS idx_spans_kind ON spans(kind)`;
		await this.sql`CREATE INDEX IF NOT EXISTS idx_spans_tool ON spans(tool_name) WHERE tool_name IS NOT NULL`;
		await this.sql`CREATE INDEX IF NOT EXISTS idx_spans_started ON spans(started_at)`;

		await this.sql`
			CREATE TABLE IF NOT EXISTS telemetry_metrics (
				id TEXT PRIMARY KEY,
				date DATE NOT NULL,
				api_key_id TEXT NOT NULL,
				project TEXT,
				model TEXT,
				metric_name TEXT NOT NULL,
				metric_value DOUBLE PRECISION NOT NULL DEFAULT 0,
				UNIQUE(date, api_key_id, project, model, metric_name)
			)
		`;
		await this.sql`CREATE INDEX IF NOT EXISTS idx_metrics_date ON telemetry_metrics(date)`;
		await this.sql`CREATE INDEX IF NOT EXISTS idx_metrics_project ON telemetry_metrics(project)`;
	}

	// --- Ingest ---

	async startTrace(params: StartTraceParams): Promise<TraceRow> {
		const id = crypto.randomUUID();
		const rows = await this.sql<TraceRow[]>`
			INSERT INTO traces (id, trace_id, api_key_id, project, git_branch, model, agent_type, started_at)
			VALUES (${id}, ${params.traceId}, ${params.apiKeyId}, ${params.project ?? null},
				${params.gitBranch ?? null}, ${params.model ?? null}, ${params.agentType ?? null},
				${params.startedAt ?? new Date().toISOString()})
			RETURNING *
		`;
		return this.normalizeTrace(rows[0] as Record<string, unknown>);
	}

	async endTrace(traceId: string, totals: TraceTotals): Promise<void> {
		await this.sql`
			UPDATE traces SET
				status = 'ended',
				ended_at = NOW(),
				total_input_tokens = COALESCE(${totals.totalInputTokens ?? null}, total_input_tokens),
				total_output_tokens = COALESCE(${totals.totalOutputTokens ?? null}, total_output_tokens),
				total_cache_read_tokens = COALESCE(${totals.totalCacheReadTokens ?? null}, total_cache_read_tokens),
				total_cache_create_tokens = COALESCE(${totals.totalCacheCreateTokens ?? null}, total_cache_create_tokens),
				total_cost_usd = COALESCE(${totals.totalCostUsd ?? null}, total_cost_usd),
				total_turns = COALESCE(${totals.totalTurns ?? null}, total_turns),
				total_tool_calls = COALESCE(${totals.totalToolCalls ?? null}, total_tool_calls),
				total_tool_failures = COALESCE(${totals.totalToolFailures ?? null}, total_tool_failures)
			WHERE trace_id = ${traceId}
		`;

		const trace = await this.getTrace(traceId);
		if (trace) await this.updateDailyMetrics(trace);
	}

	private async updateDailyMetrics(trace: TraceRow): Promise<void> {
		const date = trace.started_at.slice(0, 10);
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

		for (const [name, value] of metrics) {
			if (value === 0 && name !== "sessions") continue;
			await this.sql`
				INSERT INTO telemetry_metrics (id, date, api_key_id, project, model, metric_name, metric_value)
				VALUES (${crypto.randomUUID()}, ${date}, ${trace.api_key_id}, ${project}, ${model}, ${name}, ${value})
				ON CONFLICT (date, api_key_id, project, model, metric_name)
				DO UPDATE SET metric_value = telemetry_metrics.metric_value + EXCLUDED.metric_value
			`;
		}
	}

	async createSpan(params: CreateSpanParams): Promise<SpanRow> {
		const id = crypto.randomUUID();
		const attrs = params.attributes ? JSON.stringify(params.attributes) : null;

		const rows = await this.sql<SpanRow[]>`
			INSERT INTO spans (id, trace_id, span_id, parent_span_id, name, kind, started_at, ended_at,
				duration_ms, tool_name, input_summary, exit_code, output_size, model,
				input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_usd,
				attributes, linked_trace_id)
			VALUES (${id}, ${params.traceId}, ${params.spanId}, ${params.parentSpanId ?? null},
				${params.name}, ${params.kind}, ${params.startedAt}, ${params.endedAt ?? null},
				${params.durationMs ?? null}, ${params.toolName ?? null}, ${params.inputSummary ?? null},
				${params.exitCode ?? null}, ${params.outputSize ?? null}, ${params.model ?? null},
				${params.inputTokens ?? null}, ${params.outputTokens ?? null},
				${params.cacheReadTokens ?? null}, ${params.cacheCreateTokens ?? null},
				${params.costUsd ?? null}, ${attrs}::jsonb, ${params.linkedTraceId ?? null})
			RETURNING *
		`;
		return this.normalizeSpan(rows[0] as Record<string, unknown>);
	}

	async updateSpan(spanId: string, updates: SpanUpdates): Promise<void> {
		const sets: string[] = [];
		const values: Record<string, unknown> = {};

		if (updates.endedAt !== undefined) { sets.push("ended_at = ${endedAt}"); values.endedAt = updates.endedAt; }
		if (updates.durationMs !== undefined) { sets.push("duration_ms = ${durationMs}"); values.durationMs = updates.durationMs; }
		if (updates.status !== undefined) { sets.push("status = ${status}"); values.status = updates.status; }
		if (updates.exitCode !== undefined) { sets.push("exit_code = ${exitCode}"); values.exitCode = updates.exitCode; }
		if (updates.outputSize !== undefined) { sets.push("output_size = ${outputSize}"); values.outputSize = updates.outputSize; }
		if (updates.inputTokens !== undefined) { sets.push("input_tokens = ${inputTokens}"); values.inputTokens = updates.inputTokens; }
		if (updates.outputTokens !== undefined) { sets.push("output_tokens = ${outputTokens}"); values.outputTokens = updates.outputTokens; }
		if (updates.cacheReadTokens !== undefined) { sets.push("cache_read_tokens = ${cacheReadTokens}"); values.cacheReadTokens = updates.cacheReadTokens; }
		if (updates.cacheCreateTokens !== undefined) { sets.push("cache_create_tokens = ${cacheCreateTokens}"); values.cacheCreateTokens = updates.cacheCreateTokens; }
		if (updates.costUsd !== undefined) { sets.push("cost_usd = ${costUsd}"); values.costUsd = updates.costUsd; }
		if (updates.attributes !== undefined) { sets.push("attributes = ${attrs}::jsonb"); values.attrs = JSON.stringify(updates.attributes); }

		if (sets.length === 0) return;

		// postgres.js tagged template doesn't support dynamic SET clauses easily,
		// so we use unsafe for the SET part but parameterize the WHERE
		await this.sql.unsafe(
			`UPDATE spans SET ${sets.map((s) => s.replace(/\$\{(\w+)\}/g, (_, k) => `$${Object.keys(values).indexOf(k) + 1}`)).join(", ")} WHERE span_id = $${Object.keys(values).length + 1}`,
			[...Object.values(values), spanId],
		);
	}

	// --- Query ---

	async getTrace(traceId: string): Promise<TraceRow | null> {
		const rows = await this.sql<Record<string, unknown>[]>`
			SELECT * FROM traces WHERE trace_id = ${traceId}
		`;
		return rows.length > 0 ? this.normalizeTrace(rows[0] as Record<string, unknown>) : null;
	}

	async listTraces(opts: TraceQueryOpts): Promise<TraceRow[]> {
		const conditions: string[] = [];
		const params: unknown[] = [];
		let idx = 1;

		if (opts.from) { conditions.push(`started_at >= $${idx++}`); params.push(opts.from); }
		if (opts.to) { conditions.push(`started_at <= $${idx++}`); params.push(opts.to); }
		if (opts.apiKeyId) { conditions.push(`api_key_id = $${idx++}`); params.push(opts.apiKeyId); }
		if (opts.project) { conditions.push(`project = $${idx++}`); params.push(opts.project); }
		if (opts.status) { conditions.push(`status = $${idx++}`); params.push(opts.status); }
		if (opts.model) { conditions.push(`model = $${idx++}`); params.push(opts.model); }

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const limit = Math.min(opts.limit ?? 50, 200);
		const offset = opts.offset ?? 0;
		params.push(limit, offset);

		const rows = await this.sql.unsafe(
			`SELECT * FROM traces ${where} ORDER BY started_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
			params,
		);
		return (rows as Record<string, unknown>[]).map((r) => this.normalizeTrace(r));
	}

	async getSpansForTrace(traceId: string, kind?: SpanKind): Promise<SpanRow[]> {
		if (kind) {
			const rows = await this.sql<Record<string, unknown>[]>`
				SELECT * FROM spans WHERE trace_id = ${traceId} AND kind = ${kind} ORDER BY started_at ASC
			`;
			return (rows as Record<string, unknown>[]).map((r: Record<string, unknown>) => this.normalizeSpan(r));
		}
		const rows = await this.sql<Record<string, unknown>[]>`
			SELECT * FROM spans WHERE trace_id = ${traceId} ORDER BY started_at ASC
		`;
		return (rows as Record<string, unknown>[]).map((r: Record<string, unknown>) => this.normalizeSpan(r));
	}

	// --- Aggregation ---

	async costByProject(opts: DateRangeOpts): Promise<ProjectCost[]> {
		const { where, params } = this.buildDateFilter(opts);
		const rows = await this.sql.unsafe(
			`SELECT
				COALESCE(project, '(unknown)') as project,
				SUM(total_cost_usd) as total_cost_usd,
				COUNT(*) as session_count,
				SUM(total_turns) as total_turns
			 FROM traces ${where}
			 GROUP BY project ORDER BY total_cost_usd DESC`,
			params,
		);
		return rows as ProjectCost[];
	}

	async costByModel(opts: DateRangeOpts): Promise<ModelCost[]> {
		const { where, params } = this.buildDateFilter(opts);
		const rows = await this.sql.unsafe(
			`SELECT
				COALESCE(model, '(unknown)') as model,
				SUM(total_cost_usd) as total_cost_usd,
				SUM(total_input_tokens) as total_input_tokens,
				SUM(total_output_tokens) as total_output_tokens,
				COUNT(*) as session_count
			 FROM traces ${where}
			 GROUP BY model ORDER BY total_cost_usd DESC`,
			params,
		);
		return rows as ModelCost[];
	}

	async costByDay(opts: DateRangeOpts): Promise<DailyCost[]> {
		const { where, params } = this.buildDateFilter(opts);
		const rows = await this.sql.unsafe(
			`SELECT
				started_at::date as date,
				SUM(total_cost_usd) as total_cost_usd,
				COUNT(*) as session_count,
				SUM(total_turns) as total_turns
			 FROM traces ${where}
			 GROUP BY started_at::date ORDER BY date ASC`,
			params,
		);
		return (rows as Array<Record<string, unknown>>).map((r) => ({
			date: String(r.date),
			total_cost_usd: Number(r.total_cost_usd),
			session_count: Number(r.session_count),
			total_turns: Number(r.total_turns),
		}));
	}

	async toolUsageStats(opts: DateRangeOpts): Promise<ToolStats[]> {
		const { where, params } = this.buildDateFilter(opts);
		const kindCondition = where ? " AND kind = 'tool'" : "WHERE kind = 'tool'";
		const rows = await this.sql.unsafe(
			`SELECT
				tool_name,
				COUNT(*) as call_count,
				SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failure_count,
				ROUND(CAST(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS NUMERIC) / COUNT(*), 4) as failure_rate,
				ROUND(AVG(duration_ms)::numeric, 1) as avg_duration_ms,
				COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0) as p95_duration_ms
			 FROM spans ${where}${kindCondition}
			 AND tool_name IS NOT NULL
			 GROUP BY tool_name ORDER BY call_count DESC`,
			params,
		);
		return rows as ToolStats[];
	}

	async healthy(): Promise<boolean> {
		try {
			await this.sql`SELECT 1`;
			return true;
		} catch {
			return false;
		}
	}

	// --- Helpers ---

	private buildDateFilter(opts: DateRangeOpts): { where: string; params: unknown[] } {
		const conditions: string[] = [];
		const params: unknown[] = [];
		let idx = 1;

		if (opts.from) { conditions.push(`started_at >= $${idx++}`); params.push(opts.from); }
		if (opts.to) { conditions.push(`started_at <= $${idx++}`); params.push(opts.to); }
		if (opts.apiKeyId) { conditions.push(`api_key_id = $${idx++}`); params.push(opts.apiKeyId); }
		if (opts.project) { conditions.push(`project = $${idx++}`); params.push(opts.project); }

		return {
			where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
			params,
		};
	}

	// Postgres returns Date objects and bigints; normalize to match TraceRow/SpanRow interfaces
	private normalizeTrace(row: Record<string, unknown>): TraceRow {
		return {
			id: String(row.id),
			trace_id: String(row.trace_id),
			api_key_id: String(row.api_key_id),
			project: row.project ? String(row.project) : null,
			git_branch: row.git_branch ? String(row.git_branch) : null,
			model: row.model ? String(row.model) : null,
			agent_type: row.agent_type ? String(row.agent_type) : null,
			status: String(row.status),
			started_at: row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at),
			ended_at: row.ended_at instanceof Date ? row.ended_at.toISOString() : row.ended_at ? String(row.ended_at) : null,
			total_input_tokens: Number(row.total_input_tokens ?? 0),
			total_output_tokens: Number(row.total_output_tokens ?? 0),
			total_cache_read_tokens: Number(row.total_cache_read_tokens ?? 0),
			total_cache_create_tokens: Number(row.total_cache_create_tokens ?? 0),
			total_cost_usd: Number(row.total_cost_usd ?? 0),
			total_turns: Number(row.total_turns ?? 0),
			total_tool_calls: Number(row.total_tool_calls ?? 0),
			total_tool_failures: Number(row.total_tool_failures ?? 0),
			summary: row.summary ? String(row.summary) : null,
			last_compressed_at: row.last_compressed_at instanceof Date ? row.last_compressed_at.toISOString() : row.last_compressed_at ? String(row.last_compressed_at) : null,
		};
	}

	private normalizeSpan(row: Record<string, unknown>): SpanRow {
		return {
			id: String(row.id),
			trace_id: String(row.trace_id),
			span_id: String(row.span_id),
			parent_span_id: row.parent_span_id ? String(row.parent_span_id) : null,
			name: String(row.name),
			kind: String(row.kind),
			status: String(row.status),
			started_at: row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at),
			ended_at: row.ended_at instanceof Date ? row.ended_at.toISOString() : row.ended_at ? String(row.ended_at) : null,
			duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
			tool_name: row.tool_name ? String(row.tool_name) : null,
			input_summary: row.input_summary ? String(row.input_summary) : null,
			exit_code: row.exit_code != null ? Number(row.exit_code) : null,
			output_size: row.output_size != null ? Number(row.output_size) : null,
			model: row.model ? String(row.model) : null,
			input_tokens: row.input_tokens != null ? Number(row.input_tokens) : null,
			output_tokens: row.output_tokens != null ? Number(row.output_tokens) : null,
			cache_read_tokens: row.cache_read_tokens != null ? Number(row.cache_read_tokens) : null,
			cache_create_tokens: row.cache_create_tokens != null ? Number(row.cache_create_tokens) : null,
			cost_usd: row.cost_usd != null ? Number(row.cost_usd) : null,
			attributes: row.attributes ? (typeof row.attributes === "string" ? row.attributes : JSON.stringify(row.attributes)) : null,
			linked_trace_id: row.linked_trace_id ? String(row.linked_trace_id) : null,
		};
	}
}
