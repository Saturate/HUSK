import {
	createSpanData,
	endSpan,
	insertSpan,
	loadState,
} from "@husk/telemetry-core";

export async function handlePrompt(
	input: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
	const sessionId = input.session_id as string;
	const prompt = (input.prompt as string) ?? "";

	const state = loadState(sessionId);
	if (!state) return null;

	const span = createSpanData({
		traceId: state.traceId,
		parentSpanId: state.currentTurnSpanId,
		name: "prompt",
		kind: "prompt",
		inputSummary: prompt.slice(0, 2000),
		attributes: { length_chars: prompt.length },
	});

	const ended = endSpan(span);
	insertSpan(ended);

	return null;
}
