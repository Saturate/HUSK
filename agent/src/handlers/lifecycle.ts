import {
	createSpanData,
	endSpan,
	insertSpan,
	loadState,
} from "@husk/telemetry-core";
import type { SpanKind } from "@husk/telemetry-core";

const EVENT_TO_KIND: Record<string, SpanKind> = {
	PreCompact: "compaction",
	PostCompact: "compaction",
	Notification: "notification",
	PermissionRequest: "permission",
	PermissionDenied: "permission",
	ConfigChange: "config",
	InstructionsLoaded: "config",
	WorktreeCreate: "worktree",
	WorktreeRemove: "worktree",
	TaskCreated: "task",
	TaskCompleted: "task",
	TeammateIdle: "task",
};

export async function handleLifecycle(
	input: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
	const event = input.hook_event_name as string;
	const sessionId = input.session_id as string;

	const state = loadState(sessionId);
	if (!state) return null;

	const kind = EVENT_TO_KIND[event];
	if (!kind) return null;

	// Build attributes from event-specific fields
	const attributes: Record<string, unknown> = { event };

	if (event === "Notification") {
		attributes.notification_type = input.notification_type;
		attributes.title = input.title;
		attributes.message = (input.message as string)?.slice(0, 500);
	} else if (event === "PermissionRequest" || event === "PermissionDenied") {
		attributes.tool_name = input.tool_name;
	} else if (event === "ConfigChange") {
		attributes.config_source = input.config_source;
	} else if (event === "WorktreeCreate" || event === "WorktreeRemove") {
		attributes.worktree_path = input.worktree_path;
	} else if (event === "TaskCreated" || event === "TaskCompleted" || event === "TeammateIdle") {
		attributes.task_id = input.task_id;
	}

	const inputSummary =
		event === "PermissionRequest" || event === "PermissionDenied"
			? (input.tool_name as string) ?? null
			: event === "Notification"
				? (input.title as string) ?? null
				: null;

	const span = createSpanData({
		traceId: state.traceId,
		parentSpanId: state.currentTurnSpanId,
		name: event,
		kind,
		inputSummary,
		attributes,
	});

	const ended = endSpan(span);
	insertSpan(ended);

	return null;
}
