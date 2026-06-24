import {
	createSpanData,
	endSpan,
	insertSpan,
	loadState,
	saveState,
} from "@husk/telemetry-core";

function summarizeToolInput(toolName: string, toolInput: Record<string, unknown>): string | null {
	switch (toolName) {
		case "Bash":
			return (toolInput.command as string)?.slice(0, 500) ?? null;
		case "Read":
			return (toolInput.file_path as string) ?? null;
		case "Write":
			return (toolInput.file_path as string) ?? null;
		case "Edit":
			return (toolInput.file_path as string) ?? null;
		case "Grep":
			return (toolInput.pattern as string) ?? null;
		case "Glob":
			return (toolInput.pattern as string) ?? null;
		case "Agent":
			return (toolInput.description as string)?.slice(0, 200) ?? null;
		case "WebFetch":
			return (toolInput.url as string) ?? null;
		case "WebSearch":
			return (toolInput.query as string) ?? null;
		case "Skill":
			return (toolInput.skill as string) ?? null;
		default:
			return null;
	}
}

export async function handleTool(
	input: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
	const event = input.hook_event_name as string;
	const sessionId = input.session_id as string;
	const toolName = (input.tool_name as string) ?? null;
	const toolUseId = (input.tool_use_id as string) ?? null;

	const state = loadState(sessionId);
	if (!state) return null;

	if (event === "PreToolUse") {
		// Store start time for duration calculation
		if (toolUseId) {
			state.pendingTools[toolUseId] = Number(process.hrtime.bigint());
			saveState(sessionId, state);
		}
		return null;
	}

	if (event === "PostToolUse" || event === "PostToolUseFailure") {
		state.turnToolCount++;
		if (event === "PostToolUseFailure") {
			state.turnFailureCount++;
		}

		// Calculate duration from pending start time
		let durationMs: number | null = null;
		if (toolUseId && state.pendingTools[toolUseId]) {
			const startNs = state.pendingTools[toolUseId] as number;
			durationMs = Math.round((Number(process.hrtime.bigint()) - startNs) / 1_000_000);
			delete state.pendingTools[toolUseId];
		}

		const toolInput = (input.tool_input as Record<string, unknown>) ?? {};
		const inputSummary = toolName ? summarizeToolInput(toolName, toolInput) : null;

		const span = createSpanData({
			traceId: state.traceId,
			parentSpanId: state.currentTurnSpanId,
			name: `tool/${toolName ?? "unknown"}`,
			kind: "tool",
			toolName,
			inputSummary,
		});

		const outputSize =
			typeof input.tool_response === "string" ? input.tool_response.length : null;
		const exitCode = input.exit_code != null ? Number(input.exit_code) : null;

		const ended = endSpan(span, {
			durationMs: durationMs ?? undefined,
			status: event === "PostToolUseFailure" ? "error" : "ok",
			exitCode: exitCode ?? undefined,
			outputSize: outputSize ?? undefined,
		});

		insertSpan(ended);
		saveState(sessionId, state);
		return null;
	}

	if (event === "PostToolBatch") {
		// Log a batch summary span
		const batchSize = (input.tool_count as number) ?? 0;
		const span = createSpanData({
			traceId: state.traceId,
			parentSpanId: state.currentTurnSpanId,
			name: `batch/${batchSize}`,
			kind: "batch",
			attributes: { tool_count: batchSize },
		});
		const ended = endSpan(span);
		insertSpan(ended);
		return null;
	}

	return null;
}
