import { getLogger } from "@logtape/logtape";
import { getConfigWithEnv } from "./db.js";
import { compressTrace, getKnowledgeSpanCount, getUncompressedTraces } from "./span-compression.js";
import { getTelemetryProviderOrNull } from "./telemetry.js";

const log = getLogger(["husk", "trace-compression"]);

let staleCheckInterval: ReturnType<typeof setInterval> | null = null;
let initialized = false;

function isServerMode(): boolean {
	return (getConfigWithEnv("compression_mode", "HUSK_COMPRESSION_MODE") ?? "client") === "server";
}

function getBatchSize(): number {
	const raw = Number(
		getConfigWithEnv("compression_batch_size", "HUSK_COMPRESSION_BATCH_SIZE") ?? "20",
	);
	return Number.isFinite(raw) ? Math.min(Math.max(raw, 5), 100) : 20;
}

function getIntervalMinutes(): number {
	const raw = Number(
		getConfigWithEnv("compression_interval_minutes", "HUSK_COMPRESSION_INTERVAL_MINUTES") ?? "15",
	);
	return Number.isFinite(raw) ? Math.min(Math.max(raw, 5), 60) : 15;
}

export async function compressTraceIfReady(traceId: string): Promise<void> {
	if (!isServerMode()) return;

	const provider = getTelemetryProviderOrNull();
	if (!provider) return;

	const trace = await provider.getTrace(traceId);
	if (!trace) return;

	const count = getKnowledgeSpanCount(traceId, trace.last_compressed_at);
	if (count < getBatchSize() && trace.status !== "ended") return;

	try {
		await compressTrace(trace);
	} catch (err) {
		log.error("Trace compression failed for {id}: {error}", {
			id: traceId,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

export async function runTraceCompressionCycle(): Promise<void> {
	if (!isServerMode()) return;

	const traces = getUncompressedTraces();
	for (const trace of traces) {
		try {
			await compressTrace(trace);
		} catch (err) {
			log.error("Trace compression catch-up failed for {id}: {error}", {
				id: trace.trace_id,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	if (traces.length > 0) {
		log.info("Trace compression catch-up: processed {count} traces", { count: traces.length });
	}
}

export function initTraceCompressionListener(): void {
	if (initialized) return;
	initialized = true;

	staleCheckInterval = setInterval(async () => {
		if (!isServerMode()) return;

		const provider = getTelemetryProviderOrNull();
		if (!provider) return;

		try {
			const activeTraces = await provider.listTraces({ status: "active", limit: 50 });
			const batchSize = getBatchSize();

			for (const trace of activeTraces) {
				const count = getKnowledgeSpanCount(trace.trace_id, trace.last_compressed_at);
				if (count >= batchSize) {
					log.info("Stale trace compression for {id} ({count} knowledge spans)", {
						id: trace.trace_id,
						count,
					});
					compressTrace(trace).catch((err) => {
						log.error("Stale trace compression failed: {error}", {
							error: err instanceof Error ? err.message : String(err),
						});
					});
				}
			}
		} catch (err) {
			log.error("Stale trace check failed: {error}", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}, 60_000);
}

export function stopTraceCompressionListener(): void {
	if (staleCheckInterval) {
		clearInterval(staleCheckInterval);
		staleCheckInterval = null;
	}
	initialized = false;
}
