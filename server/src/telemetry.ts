import { getLogger } from "@logtape/logtape";

const log = getLogger(["husk", "telemetry"]);

// --- Types ---

export const SPAN_KINDS = [
	"turn",
	"tool",
	"subagent",
	"compaction",
	"permission",
	"notification",
	"config",
	"worktree",
	"task",
	"batch",
	"skill",
	"prompt",
] as const;
export type SpanKind = (typeof SPAN_KINDS)[number];

export interface TraceRow {
	id: string;
	trace_id: string;
	api_key_id: string;
	project: string | null;
	git_branch: string | null;
	model: string | null;
	agent_type: string | null;
	status: string;
	started_at: string;
	ended_at: string | null;
	total_input_tokens: number;
	total_output_tokens: number;
	total_cache_read_tokens: number;
	total_cache_create_tokens: number;
	total_cost_usd: number;
	total_turns: number;
	total_tool_calls: number;
	total_tool_failures: number;
	summary: string | null;
	last_compressed_at: string | null;
}

export interface SpanRow {
	id: string;
	trace_id: string;
	span_id: string;
	parent_span_id: string | null;
	name: string;
	kind: string;
	status: string;
	started_at: string;
	ended_at: string | null;
	duration_ms: number | null;
	tool_name: string | null;
	input_summary: string | null;
	exit_code: number | null;
	output_size: number | null;
	model: string | null;
	input_tokens: number | null;
	output_tokens: number | null;
	cache_read_tokens: number | null;
	cache_create_tokens: number | null;
	cost_usd: number | null;
	attributes: string | null;
	linked_trace_id: string | null;
}

export interface StartTraceParams {
	traceId: string;
	apiKeyId: string;
	project?: string | null;
	gitBranch?: string | null;
	model?: string | null;
	agentType?: string | null;
	startedAt?: string;
}

export interface TraceTotals {
	totalInputTokens?: number;
	totalOutputTokens?: number;
	totalCacheReadTokens?: number;
	totalCacheCreateTokens?: number;
	totalCostUsd?: number;
	totalTurns?: number;
	totalToolCalls?: number;
	totalToolFailures?: number;
}

export interface CreateSpanParams {
	traceId: string;
	spanId: string;
	parentSpanId?: string | null;
	name: string;
	kind: SpanKind;
	startedAt: string;
	endedAt?: string | null;
	durationMs?: number | null;
	toolName?: string | null;
	inputSummary?: string | null;
	exitCode?: number | null;
	outputSize?: number | null;
	model?: string | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	cacheReadTokens?: number | null;
	cacheCreateTokens?: number | null;
	costUsd?: number | null;
	attributes?: Record<string, unknown> | null;
	linkedTraceId?: string | null;
}

export interface SpanUpdates {
	endedAt?: string;
	durationMs?: number;
	status?: string;
	exitCode?: number;
	outputSize?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheCreateTokens?: number;
	costUsd?: number;
	attributes?: Record<string, unknown>;
}

export interface DateRangeOpts {
	from?: string;
	to?: string;
	apiKeyId?: string;
	project?: string;
}

export interface TraceQueryOpts extends DateRangeOpts {
	status?: string;
	model?: string;
	limit?: number;
	offset?: number;
}

export interface ProjectCost {
	project: string;
	total_cost_usd: number;
	session_count: number;
	total_turns: number;
}

export interface ModelCost {
	model: string;
	total_cost_usd: number;
	total_input_tokens: number;
	total_output_tokens: number;
	session_count: number;
}

export interface DailyCost {
	date: string;
	total_cost_usd: number;
	session_count: number;
	total_turns: number;
}

export interface ToolStats {
	tool_name: string;
	call_count: number;
	failure_count: number;
	failure_rate: number;
	avg_duration_ms: number;
	p95_duration_ms: number;
}

export interface ModelDetail {
	model: string;
	session_count: number;
	total_turns: number;
	total_input_tokens: number;
	total_output_tokens: number;
	total_cache_read_tokens: number;
	total_cache_create_tokens: number;
	total_cost_usd: number;
	avg_output_per_turn: number;
	avg_input_per_turn: number;
	avg_cost_per_turn: number;
	cache_hit_rate: number;
}

// --- Interface ---

export interface TelemetryProvider {
	readonly name: string;
	init(): Promise<void>;

	// Ingest
	startTrace(params: StartTraceParams): Promise<TraceRow>;
	endTrace(traceId: string, totals: TraceTotals): Promise<void>;
	createSpan(params: CreateSpanParams): Promise<SpanRow>;
	updateSpan(spanId: string, updates: SpanUpdates): Promise<void>;

	// Query
	getTrace(traceId: string): Promise<TraceRow | null>;
	listTraces(opts: TraceQueryOpts): Promise<TraceRow[]>;
	getSpansForTrace(traceId: string, kind?: SpanKind): Promise<SpanRow[]>;

	// Aggregation
	costByProject(opts: DateRangeOpts): Promise<ProjectCost[]>;
	costByModel(opts: DateRangeOpts): Promise<ModelCost[]>;
	costByDay(opts: DateRangeOpts): Promise<DailyCost[]>;
	toolUsageStats(opts: DateRangeOpts): Promise<ToolStats[]>;
	modelDetails(opts: DateRangeOpts): Promise<ModelDetail[]>;

	healthy(): Promise<boolean>;
}

// --- Singleton + factory ---

let provider: TelemetryProvider | null = null;

export function getTelemetryProvider(): TelemetryProvider {
	if (!provider) {
		throw new Error("Telemetry not initialized — call initTelemetry() first");
	}
	return provider;
}

export function getTelemetryProviderOrNull(): TelemetryProvider | null {
	return provider;
}

export function setTelemetryProvider(p: TelemetryProvider | null): void {
	provider = p;
}

export async function initTelemetry(): Promise<void> {
	const backend = process.env.HUSK_TELEMETRY ?? "sqlite";

	if (backend === "none") {
		log.info("Telemetry disabled");
		return;
	}

	switch (backend) {
		case "postgres": {
			const { PostgresTelemetryProvider } = await import("./telemetry-postgres.js");
			provider = new PostgresTelemetryProvider();
			break;
		}
		case "otlp": {
			const { OtlpTelemetryProvider } = await import("./telemetry-otlp.js");
			provider = new OtlpTelemetryProvider();
			break;
		}
		default: {
			const { SqliteTelemetryProvider } = await import("./telemetry-sqlite.js");
			provider = new SqliteTelemetryProvider();
			break;
		}
	}

	await provider.init();
	log.info("Telemetry ready ({name})", { name: provider.name });
}
