import { getUnsyncedSpans, getUnsyncedTraces, markSpansSynced, markTracesSynced } from "./local-store.js";
import type { SyncConfig } from "./types.js";

export function loadSyncConfig(): SyncConfig {
	const localMode = process.env.HUSK_TELEMETRY_LOCAL ?? "true";

	return {
		serverUrl: process.env.HUSK_URL ?? null,
		apiKey: process.env.HUSK_KEY ?? null,
		localOnly: localMode === "only",
		keepLocal: localMode !== "false",
	};
}

export async function syncToServer(config: SyncConfig): Promise<{ traces: number; spans: number }> {
	if (config.localOnly || !config.serverUrl || !config.apiKey) {
		return { traces: 0, spans: 0 };
	}

	let syncedTraces = 0;
	let syncedSpans = 0;

	// Sync traces
	const traces = getUnsyncedTraces(50);
	if (traces.length > 0) {
		for (const trace of traces) {
			try {
				const resp = await fetch(`${config.serverUrl}/telemetry/ingest/traces`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${config.apiKey}`,
					},
					body: JSON.stringify({
						trace_id: trace.trace_id,
						...(trace.data as unknown as Record<string, unknown>),
					}),
					signal: AbortSignal.timeout(5000),
				});
				if (resp.ok) {
					markTracesSynced([trace.trace_id]);
					syncedTraces++;
				}
			} catch {
				// Server unreachable; stop trying for this batch
				break;
			}
		}
	}

	// Sync spans in batches
	const spans = getUnsyncedSpans(100);
	if (spans.length > 0) {
		try {
			const resp = await fetch(`${config.serverUrl}/telemetry/ingest/spans`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${config.apiKey}`,
				},
				body: JSON.stringify({
					spans: spans.map((s) => ({
						trace_id: s.traceId,
						span_id: s.spanId,
						parent_span_id: s.parentSpanId,
						name: s.name,
						kind: s.kind,
						status: s.status,
						started_at: s.startedAt,
						ended_at: s.endedAt,
						duration_ms: s.durationMs,
						tool_name: s.toolName,
						input_summary: s.inputSummary,
						exit_code: s.exitCode,
						output_size: s.outputSize,
						model: s.model,
						input_tokens: s.inputTokens,
						output_tokens: s.outputTokens,
						cache_read_tokens: s.cacheReadTokens,
						cache_create_tokens: s.cacheCreateTokens,
						cost_usd: s.costUsd,
						attributes: s.attributes,
					})),
				}),
				signal: AbortSignal.timeout(5000),
			});
			if (resp.ok) {
				markSpansSynced(spans.map((s) => s.spanId));
				syncedSpans = spans.length;
			}
		} catch {
			// Server unreachable; spans stay unsynced for next attempt
		}
	}

	return { traces: syncedTraces, spans: syncedSpans };
}
