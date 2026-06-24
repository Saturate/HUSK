import { getLogger } from "@logtape/logtape";
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
import { SqliteTelemetryProvider } from "./telemetry-sqlite.js";

const log = getLogger(["husk", "telemetry-otlp"]);

// OTel status codes
const STATUS_OK = 1;
const STATUS_ERROR = 2;

// OTel span kind: INTERNAL for all our spans (they're internal agent operations)
const SPAN_KIND_INTERNAL = 1;

interface OtlpKeyValue {
	key: string;
	value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean };
}

interface OtlpSpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: number;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
	status: { code: number };
	attributes: OtlpKeyValue[];
}

function isoToUnixNano(iso: string): string {
	const ms = new Date(iso).getTime();
	return (BigInt(ms) * 1_000_000n).toString();
}

function toOtlpAttribute(key: string, value: unknown): OtlpKeyValue | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "string") return { key, value: { stringValue: value } };
	if (typeof value === "number") {
		if (Number.isInteger(value)) return { key, value: { intValue: String(value) } };
		return { key, value: { doubleValue: value } };
	}
	if (typeof value === "boolean") return { key, value: { boolValue: value } };
	return { key, value: { stringValue: JSON.stringify(value) } };
}

export function spanRowToOtlp(span: SpanRow): OtlpSpan {
	const attrs: OtlpKeyValue[] = [];
	const maybeAttr = (key: string, value: unknown) => {
		const a = toOtlpAttribute(key, value);
		if (a) attrs.push(a);
	};

	maybeAttr("husk.span.kind", span.kind);
	maybeAttr("husk.tool.name", span.tool_name);
	maybeAttr("husk.input_summary", span.input_summary);
	maybeAttr("husk.exit_code", span.exit_code);
	maybeAttr("husk.output_size", span.output_size);
	maybeAttr("husk.model", span.model);
	maybeAttr("husk.tokens.input", span.input_tokens);
	maybeAttr("husk.tokens.output", span.output_tokens);
	maybeAttr("husk.tokens.cache_read", span.cache_read_tokens);
	maybeAttr("husk.tokens.cache_create", span.cache_create_tokens);
	maybeAttr("husk.cost_usd", span.cost_usd);

	if (span.attributes) {
		try {
			const parsed = JSON.parse(span.attributes) as Record<string, unknown>;
			for (const [k, v] of Object.entries(parsed)) {
				maybeAttr(`husk.attr.${k}`, v);
			}
		} catch {
			// Malformed attributes JSON
		}
	}

	return {
		traceId: span.trace_id,
		spanId: span.span_id,
		parentSpanId: span.parent_span_id ?? undefined,
		name: span.name,
		kind: SPAN_KIND_INTERNAL,
		startTimeUnixNano: isoToUnixNano(span.started_at),
		endTimeUnixNano: span.ended_at ? isoToUnixNano(span.ended_at) : isoToUnixNano(span.started_at),
		status: { code: span.status === "error" ? STATUS_ERROR : STATUS_OK },
		attributes: attrs,
	};
}

function buildOtlpPayload(spans: OtlpSpan[]): object {
	return {
		resourceSpans: [
			{
				resource: {
					attributes: [
						{ key: "service.name", value: { stringValue: "husk" } },
						{ key: "service.version", value: { stringValue: "0.1.0" } },
					],
				},
				scopeSpans: [
					{
						scope: { name: "husk-telemetry", version: "0.1.0" },
						spans,
					},
				],
			},
		],
	};
}

export class OtlpTelemetryProvider implements TelemetryProvider {
	readonly name = "otlp";
	private sqlite: SqliteTelemetryProvider;
	private endpoint: string;
	private pendingSpans: OtlpSpan[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		this.sqlite = new SqliteTelemetryProvider();
		this.endpoint = process.env.HUSK_OTLP_ENDPOINT ?? "http://localhost:4318";
	}

	async init(): Promise<void> {
		await this.sqlite.init();
		log.info("OTLP export enabled, endpoint: {endpoint}", { endpoint: this.endpoint });
	}

	// --- Ingest (write to SQLite, then async export to OTLP) ---

	async startTrace(params: StartTraceParams): Promise<TraceRow> {
		return this.sqlite.startTrace(params);
	}

	async endTrace(traceId: string, totals: TraceTotals): Promise<void> {
		await this.sqlite.endTrace(traceId, totals);
	}

	async createSpan(params: CreateSpanParams): Promise<SpanRow> {
		const span = await this.sqlite.createSpan(params);
		this.enqueueSpan(span);
		return span;
	}

	async updateSpan(spanId: string, updates: SpanUpdates): Promise<void> {
		await this.sqlite.updateSpan(spanId, updates);
	}

	// --- Query (delegate to SQLite) ---

	getTrace(traceId: string): Promise<TraceRow | null> {
		return this.sqlite.getTrace(traceId);
	}

	listTraces(opts: TraceQueryOpts): Promise<TraceRow[]> {
		return this.sqlite.listTraces(opts);
	}

	getSpansForTrace(traceId: string, kind?: SpanKind): Promise<SpanRow[]> {
		return this.sqlite.getSpansForTrace(traceId, kind);
	}

	costByProject(opts: DateRangeOpts): Promise<ProjectCost[]> {
		return this.sqlite.costByProject(opts);
	}

	costByModel(opts: DateRangeOpts): Promise<ModelCost[]> {
		return this.sqlite.costByModel(opts);
	}

	costByDay(opts: DateRangeOpts): Promise<DailyCost[]> {
		return this.sqlite.costByDay(opts);
	}

	toolUsageStats(opts: DateRangeOpts): Promise<ToolStats[]> {
		return this.sqlite.toolUsageStats(opts);
	}

	modelDetails(opts: DateRangeOpts): Promise<import("./telemetry.js").ModelDetail[]> {
		return this.sqlite.modelDetails(opts);
	}

	healthy(): Promise<boolean> {
		return this.sqlite.healthy();
	}

	// --- OTLP export internals ---

	private enqueueSpan(span: SpanRow): void {
		this.pendingSpans.push(spanRowToOtlp(span));

		if (this.pendingSpans.length >= 50) {
			this.flush();
		} else if (!this.flushTimer) {
			this.flushTimer = setTimeout(() => this.flush(), 5000);
		}
	}

	private flush(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		if (this.pendingSpans.length === 0) return;

		const batch = this.pendingSpans.splice(0);
		const payload = buildOtlpPayload(batch);

		fetch(`${this.endpoint}/v1/traces`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(5000),
		}).catch((err: unknown) => {
			log.warn("OTLP export failed: {error}", {
				error: err instanceof Error ? err.message : String(err),
			});
		});
	}
}
