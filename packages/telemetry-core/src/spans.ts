import { calculateCost } from "./cost.js";
import type { SpanData, SpanKind, TraceData } from "./types.js";

function randomHex(bytes: number): string {
	const arr = new Uint8Array(bytes);
	crypto.getRandomValues(arr);
	return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateTraceId(sessionId: string): string {
	// Deterministic 128-bit trace ID from session ID via SHA-256.
	// Changing this algorithm invalidates existing backfilled trace IDs; re-run backfill after changes.
	const hash = new Bun.CryptoHasher("sha256").update(sessionId).digest("hex");
	return hash.slice(0, 32);
}

export function generateSpanId(): string {
	return randomHex(8); // 16 hex chars
}

export function createTraceData(params: {
	sessionId: string;
	project?: string | null;
	gitBranch?: string | null;
	model?: string | null;
	agentType?: string | null;
}): TraceData {
	return {
		traceId: generateTraceId(params.sessionId),
		project: params.project ?? null,
		gitBranch: params.gitBranch ?? null,
		model: params.model ?? null,
		agentType: params.agentType ?? null,
		startedAt: new Date().toISOString(),
	};
}

export function createSpanData(params: {
	traceId: string;
	parentSpanId?: string | null;
	name: string;
	kind: SpanKind;
	startedAt?: string;
	toolName?: string | null;
	inputSummary?: string | null;
	model?: string | null;
	attributes?: Record<string, unknown> | null;
}): SpanData {
	return {
		traceId: params.traceId,
		spanId: generateSpanId(),
		parentSpanId: params.parentSpanId ?? null,
		name: params.name,
		kind: params.kind,
		status: "ok",
		startedAt: params.startedAt ?? new Date().toISOString(),
		endedAt: null,
		durationMs: null,
		toolName: params.toolName ?? null,
		inputSummary: params.inputSummary ?? null,
		exitCode: null,
		outputSize: null,
		model: params.model ?? null,
		inputTokens: null,
		outputTokens: null,
		cacheReadTokens: null,
		cacheCreateTokens: null,
		costUsd: null,
		attributes: params.attributes ?? null,
	};
}

export function endSpan(
	span: SpanData,
	params?: {
		status?: "ok" | "error";
		exitCode?: number;
		outputSize?: number;
		durationMs?: number;
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheCreateTokens?: number;
		model?: string;
	},
): SpanData {
	const now = new Date().toISOString();
	const durationMs =
		params?.durationMs ?? new Date(now).getTime() - new Date(span.startedAt).getTime();

	let costUsd: number | null = null;
	if (params?.inputTokens != null && params?.outputTokens != null && params?.model) {
		costUsd = calculateCost({
			model: params.model,
			inputTokens: params.inputTokens,
			outputTokens: params.outputTokens,
			cacheReadTokens: params.cacheReadTokens ?? 0,
			cacheCreateTokens: params.cacheCreateTokens ?? 0,
		});
	}

	return {
		...span,
		status: params?.status ?? span.status,
		endedAt: now,
		durationMs,
		exitCode: params?.exitCode ?? span.exitCode,
		outputSize: params?.outputSize ?? span.outputSize,
		inputTokens: params?.inputTokens ?? span.inputTokens,
		outputTokens: params?.outputTokens ?? span.outputTokens,
		cacheReadTokens: params?.cacheReadTokens ?? span.cacheReadTokens,
		cacheCreateTokens: params?.cacheCreateTokens ?? span.cacheCreateTokens,
		costUsd,
	};
}
