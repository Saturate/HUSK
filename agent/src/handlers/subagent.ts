import {
	createSpanData,
	endSpan,
	insertSpan,
	loadState,
	saveState,
	calculateCost,
} from "@husk/telemetry-core";

export async function handleSubagent(
	input: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
	const event = input.hook_event_name as string;
	const sessionId = input.session_id as string;
	const agentId = (input.agent_id as string) ?? null;
	const agentType = (input.agent_type as string) ?? null;

	const state = loadState(sessionId);
	if (!state) return null;

	if (event === "SubagentStart") {
		// Store start time
		if (agentId) {
			state.pendingTools[`subagent:${agentId}`] = Number(process.hrtime.bigint());
			saveState(sessionId, state);
		}
		return null;
	}

	if (event === "SubagentStop") {
		let durationMs: number | null = null;
		const key = `subagent:${agentId}`;
		if (agentId && state.pendingTools[key]) {
			const startNs = state.pendingTools[key] as number;
			durationMs = Math.round((Number(process.hrtime.bigint()) - startNs) / 1_000_000);
			delete state.pendingTools[key];
		}

		const usage = input.usage as
			| {
					input_tokens?: number;
					output_tokens?: number;
					cache_read_input_tokens?: number;
					cache_creation_input_tokens?: number;
			  }
			| undefined;

		const span = createSpanData({
			traceId: state.traceId,
			parentSpanId: state.currentTurnSpanId,
			name: `subagent/${agentType ?? agentId ?? "unknown"}`,
			kind: "subagent",
			attributes: { agent_id: agentId, agent_type: agentType },
		});

		const inputTokens = usage?.input_tokens ?? 0;
		const outputTokens = usage?.output_tokens ?? 0;

		const ended = endSpan(span, {
			durationMs: durationMs ?? undefined,
			inputTokens,
			outputTokens,
			cacheReadTokens: usage?.cache_read_input_tokens,
			cacheCreateTokens: usage?.cache_creation_input_tokens,
			model: state.model ?? undefined,
		});

		if (state.model && (inputTokens > 0 || outputTokens > 0)) {
			ended.costUsd = calculateCost({
				model: state.model,
				inputTokens,
				outputTokens,
				cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
				cacheCreateTokens: usage?.cache_creation_input_tokens ?? 0,
			});
		}

		insertSpan(ended);
		saveState(sessionId, state);
	}

	return null;
}
