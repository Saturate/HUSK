// Shared types for all telemetry consumers (husk-agent, opencode plugin, etc.)

export const SPAN_KINDS = [
	"turn",
	"tool",
	"subagent",
	"compaction",
	"permission",
	"notification",
	"config",
	"worktree",
	"task",
	"batch",
	"skill",
	"prompt",
] as const;
export type SpanKind = (typeof SPAN_KINDS)[number];

export interface TraceData {
	traceId: string;
	project: string | null;
	gitBranch: string | null;
	model: string | null;
	agentType: string | null;
	startedAt: string;
}

export interface SpanData {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	name: string;
	kind: SpanKind;
	status: "ok" | "error";
	startedAt: string;
	endedAt: string | null;
	durationMs: number | null;
	toolName: string | null;
	inputSummary: string | null;
	exitCode: number | null;
	outputSize: number | null;
	model: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
	cacheReadTokens: number | null;
	cacheCreateTokens: number | null;
	costUsd: number | null;
	attributes: Record<string, unknown> | null;
}

export interface TraceTotals {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCacheCreateTokens: number;
	totalCostUsd: number;
	totalTurns: number;
	totalToolCalls: number;
	totalToolFailures: number;
}

// Normalized event from any client (Claude Code, OpenCode, etc.)
export interface NormalizedEvent {
	eventType: string;
	sessionId: string;
	timestamp: string;
	project: string | null;
	gitBranch: string | null;
	cwd: string | null;
	transcriptPath: string | null;
	payload: Record<string, unknown>;
}

// Session state persisted between hook invocations
export interface SessionState {
	traceId: string;
	model: string | null;
	startedAtNs: number;
	turnCount: number;
	turnToolCount: number;
	turnFailureCount: number;
	currentTurnSpanId: string | null;
	pendingTools: Record<string, number>; // tool_use_id -> start nanos
}

// Server sync config
export interface SyncConfig {
	serverUrl: string | null;
	apiKey: string | null;
	localOnly: boolean; // HUSK_TELEMETRY_LOCAL=only
	keepLocal: boolean; // HUSK_TELEMETRY_LOCAL=true (default)
}
