import {
	createSpanData,
	endSpan,
	insertSpan,
	loadState,
	saveState,
	calculateCost,
	generateSpanId,
} from "@husk/telemetry-core";

export async function handleTurn(
	input: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
	const event = input.hook_event_name as string;
	const sessionId = input.session_id as string;

	const state = loadState(sessionId);
	if (!state) return null;

	if (event === "Stop") {
		state.turnCount++;

		// Extract usage from the hook input if available
		const usage = input.usage as
			| {
					input_tokens?: number;
					output_tokens?: number;
					cache_read_input_tokens?: number;
					cache_creation_input_tokens?: number;
			  }
			| undefined;

		const inputTokens = usage?.input_tokens ?? 0;
		const outputTokens = usage?.output_tokens ?? 0;
		const cacheRead = usage?.cache_read_input_tokens ?? 0;
		const cacheCreate = usage?.cache_creation_input_tokens ?? 0;

		let costUsd: number | null = null;
		if (state.model && (inputTokens > 0 || outputTokens > 0)) {
			costUsd = calculateCost({
				model: state.model,
				inputTokens,
				outputTokens,
				cacheReadTokens: cacheRead,
				cacheCreateTokens: cacheCreate,
			});
		}

		// Create a turn span
		const span = createSpanData({
			traceId: state.traceId,
			name: `turn/${state.turnCount}`,
			kind: "turn",
			model: state.model,
		});

		const ended = endSpan(span, {
			inputTokens,
			outputTokens,
			cacheReadTokens: cacheRead,
			cacheCreateTokens: cacheCreate,
			model: state.model ?? undefined,
		});
		if (costUsd != null) ended.costUsd = costUsd;

		insertSpan(ended);

		// Reset per-turn counters
		state.currentTurnSpanId = ended.spanId;
		state.turnToolCount = 0;
		state.turnFailureCount = 0;
		saveState(sessionId, state);
	}

	if (event === "StopFailure") {
		// Log a failed turn
		const span = createSpanData({
			traceId: state.traceId,
			name: `turn/${state.turnCount + 1}/failure`,
			kind: "turn",
			model: state.model,
			attributes: { failure: true, reason: input.reason ?? "unknown" },
		});

		const ended = endSpan(span, { status: "error" });
		insertSpan(ended);
	}

	return null;
}
