import { handleSession } from "./handlers/session.js";
import { handleTurn } from "./handlers/turn.js";
import { handleTool } from "./handlers/tool.js";
import { handleSubagent } from "./handlers/subagent.js";
import { handlePrompt } from "./handlers/prompt.js";
import { handleLifecycle } from "./handlers/lifecycle.js";

type HookResult = Record<string, unknown> | null;

const HANDLERS: Record<string, (input: Record<string, unknown>) => Promise<HookResult>> = {
	SessionStart: handleSession,
	SessionEnd: handleSession,
	PreToolUse: handleTool,
	PostToolUse: handleTool,
	PostToolUseFailure: handleTool,
	PostToolBatch: handleTool,
	Stop: handleTurn,
	StopFailure: handleTurn,
	UserPromptSubmit: handlePrompt,
	SubagentStart: handleSubagent,
	SubagentStop: handleSubagent,
	PreCompact: handleLifecycle,
	PostCompact: handleLifecycle,
	Notification: handleLifecycle,
	PermissionRequest: handleLifecycle,
	PermissionDenied: handleLifecycle,
	ConfigChange: handleLifecycle,
	WorktreeCreate: handleLifecycle,
	WorktreeRemove: handleLifecycle,
	TaskCreated: handleLifecycle,
	TaskCompleted: handleLifecycle,
	TeammateIdle: handleLifecycle,
	InstructionsLoaded: handleLifecycle,
};

export async function dispatch(input: Record<string, unknown>): Promise<HookResult> {
	const event = (input.hook_event_name as string) ?? "";
	const handler = HANDLERS[event];
	if (!handler) return null;
	return handler(input);
}
