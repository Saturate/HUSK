import { getLogger } from "@logtape/logtape";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getDb } from "./db.js";
import type { TelemetryProvider } from "./telemetry.js";

const log = getLogger(["husk", "otlp-logs"]);

// --- Types ---

interface OtlpLogRecord {
	timeUnixNano?: string;
	body?: { stringValue?: string };
	attributes?: Array<{
		key: string;
		value: { stringValue?: string; intValue?: string | number; doubleValue?: number; boolValue?: boolean };
	}>;
}

interface PendingTool {
	toolName: string;
	toolUseId: string;
	startedAt: string;
	inputSummary: string | null;
	traceId: string;
}

// --- Module state ---

const seenSessions = new Set<string>();
const pendingTools = new Map<string, PendingTool>();
const turnCounter = new Map<string, number>();
const lastEventTime = new Map<string, string>(); // session -> last event ISO timestamp

const PAUSE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes of inactivity = pause span

// --- Helpers ---

function parseAttrs(record: OtlpLogRecord): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const attr of record.attributes ?? []) {
		const v = attr.value;
		if (v.stringValue !== undefined) result[attr.key] = v.stringValue;
		else if (v.intValue !== undefined) result[attr.key] = Number(v.intValue);
		else if (v.doubleValue !== undefined) result[attr.key] = v.doubleValue;
		else if (v.boolValue !== undefined) result[attr.key] = v.boolValue;
	}
	return result;
}

function generateTraceId(sessionId: string): string {
	const hash = new Bun.CryptoHasher("sha256").update(sessionId).digest("hex");
	return hash.slice(0, 32);
}

function randomSpanId(): string {
	const arr = new Uint8Array(8);
	crypto.getRandomValues(arr);
	return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function nanoToIso(nano: string | undefined): string | null {
	if (!nano || nano === "0") return null;
	try {
		const ms = Number(BigInt(nano) / 1_000_000n);
		return new Date(ms).toISOString();
	} catch {
		return null;
	}
}

// Cache: session_id -> project name derived from transcript directory
const sessionProjectCache = new Map<string, string | null>();

function resolveProjectFromTranscript(sessionId: string): string | null {
	if (sessionProjectCache.has(sessionId)) return sessionProjectCache.get(sessionId) ?? null;

	const projectsDir = join(homedir(), ".claude", "projects");
	if (!existsSync(projectsDir)) {
		sessionProjectCache.set(sessionId, null);
		return null;
	}

	try {
		for (const dirName of readdirSync(projectsDir)) {
			const transcriptPath = join(projectsDir, dirName, `${sessionId}.jsonl`);
			if (existsSync(transcriptPath)) {
				// Decode dir name to project: -Users-alkj-code-github-HUSK -> HUSK
				const decoded = dirName.replace(/^-/, "").replace(/-/g, "/");
				const parts = decoded.split("/");
				const codeIdx = parts.indexOf("code");
				let projectParts: string[];
				if (codeIdx >= 0 && codeIdx + 1 < parts.length) {
					projectParts = parts.slice(codeIdx + 1);
				} else {
					projectParts = [parts[parts.length - 1] ?? dirName];
				}
				// Skip common parent dirs that aren't the project name (github, code)
				if (projectParts[0] === "github" && projectParts.length > 1) projectParts = projectParts.slice(1);
				const project = projectParts[projectParts.length - 1] ?? dirName;
				sessionProjectCache.set(sessionId, project);
				return project;
			}
		}
	} catch { /* best effort */ }

	sessionProjectCache.set(sessionId, null);
	return null;
}

function getApiKeyId(): string {
	const row = getDb()
		.query<{ id: string }, []>("SELECT id FROM api_keys WHERE is_active = 1 LIMIT 1")
		.get();
	return row?.id ?? "otlp-anonymous";
}

function extractToolInput(params: unknown): string | null {
	if (!params) return null;
	try {
		const p = typeof params === "string" ? JSON.parse(params) : params;
		if (typeof p === "object" && p !== null) {
			const obj = p as Record<string, unknown>;
			return (obj.full_command as string) ?? (obj.description as string) ?? JSON.stringify(p).slice(0, 2000);
		}
	} catch { /* not JSON */ }
	return typeof params === "string" ? params.slice(0, 2000) : null;
}

// --- Main converter ---

export async function processLogRecords(
	records: OtlpLogRecord[],
	provider: TelemetryProvider,
): Promise<{ spans: number; traces: number }> {
	let spanCount = 0;
	const newTraces = new Set<string>();
	const apiKeyId = getApiKeyId();

	for (const record of records) {
		const eventType = record.body?.stringValue;
		if (!eventType) continue;

		const attrs = parseAttrs(record);
		const sessionId = attrs["session.id"] as string | undefined;
		if (!sessionId) continue;

		const traceId = generateTraceId(sessionId);
		const timestamp = nanoToIso(record.timeUnixNano) ?? (attrs["event.timestamp"] as string) ?? new Date().toISOString();

		// Auto-create trace on first event for this session
		if (!seenSessions.has(sessionId)) {
			seenSessions.add(sessionId);
			const existing = await provider.getTrace(traceId);
			if (!existing) {
				try {
					const project = resolveProjectFromTranscript(sessionId);
					await provider.startTrace({
						traceId,
						apiKeyId,
						project,
						model: (attrs.model as string) ?? null,
						startedAt: timestamp,
					});
					newTraces.add(traceId);
				} catch {
					// May already exist
				}
			}
		}

		// Detect inactivity gaps and insert pause spans
		const lastTime = lastEventTime.get(sessionId);
		if (lastTime && timestamp) {
			const gap = new Date(timestamp).getTime() - new Date(lastTime).getTime();
			if (gap > PAUSE_THRESHOLD_MS) {
				const pauseMins = Math.round(gap / 60_000);
				const pauseLabel = pauseMins >= 60 ? `${Math.floor(pauseMins / 60)}h ${pauseMins % 60}m` : `${pauseMins}m`;
				try {
					await provider.createSpan({
						traceId,
						spanId: randomSpanId(),
						name: `pause/${pauseLabel}`,
						kind: "notification",
						startedAt: lastTime,
						endedAt: timestamp,
						durationMs: gap,
						attributes: { pause: true, gap_minutes: pauseMins },
					});
					spanCount++;
				} catch { /* best effort */ }
			}
		}
		if (timestamp) lastEventTime.set(sessionId, timestamp);

		switch (eventType) {
			case "claude_code.api_request": {
				const model = (attrs.model as string) ?? null;
				const inputTokens = attrs.input_tokens != null ? Number(attrs.input_tokens) : null;
				const outputTokens = attrs.output_tokens != null ? Number(attrs.output_tokens) : null;
				const cacheRead = attrs.cache_read_tokens != null ? Number(attrs.cache_read_tokens) : null;
				const cacheCreate = attrs.cache_creation_tokens != null ? Number(attrs.cache_creation_tokens) : null;
				const costUsd = attrs.cost_usd != null ? Number(attrs.cost_usd) : null;
				const durationMs = attrs.duration_ms != null ? Number(attrs.duration_ms) : null;

				const count = (turnCounter.get(sessionId) ?? 0) + 1;
				turnCounter.set(sessionId, count);

				await provider.createSpan({
					traceId,
					spanId: randomSpanId(),
					name: `turn/${count}`,
					kind: "turn",
					startedAt: timestamp,
					endedAt: timestamp,
					durationMs,
					model,
					inputTokens,
					outputTokens,
					cacheReadTokens: cacheRead,
					cacheCreateTokens: cacheCreate,
					costUsd,
					attributes: {
						effort: attrs.effort,
						speed: attrs.speed,
						query_source: attrs.query_source,
						request_id: attrs.request_id,
					},
				});
				spanCount++;

				// Rolling trace totals
				const db = getDb();
				db.query(
					`UPDATE traces SET
						total_turns = total_turns + 1,
						total_cost_usd = total_cost_usd + COALESCE(?, 0),
						total_input_tokens = total_input_tokens + COALESCE(?, 0),
						total_output_tokens = total_output_tokens + COALESCE(?, 0),
						model = COALESCE(?, model)
					 WHERE trace_id = ?`,
				).run(costUsd, inputTokens, outputTokens, model, traceId);

				break;
			}

			case "claude_code.tool_decision": {
				const toolName = (attrs.tool_name as string) ?? "unknown";
				const toolUseId = (attrs.tool_use_id as string) ?? randomSpanId();
				const decision = (attrs.decision as string) ?? "accept";
				const inputSummary = extractToolInput(attrs.tool_parameters);

				if (decision === "reject") {
					// Rejected tool = permission span
					const spanId = randomSpanId();
					await provider.createSpan({
						traceId,
						spanId,
						name: `permission/${toolName}`,
						kind: "permission",
						startedAt: timestamp,
						endedAt: timestamp,
						toolName,
						inputSummary,
						attributes: { decision: "reject", tool_use_id: toolUseId },
					});
					await provider.updateSpan(spanId, { status: "error" });
					spanCount++;
				} else {
					// Accepted tool: store as pending, wait for tool_result
					pendingTools.set(toolUseId, {
						toolName,
						toolUseId,
						startedAt: timestamp,
						inputSummary,
						traceId,
					});
				}
				break;
			}

			case "claude_code.tool_result": {
				const toolUseId = (attrs.tool_use_id as string) ?? "";
				const durationMs = attrs.duration_ms != null ? Number(attrs.duration_ms) : null;
				const pending = pendingTools.get(toolUseId);

				if (pending) {
					pendingTools.delete(toolUseId);
					await provider.createSpan({
						traceId: pending.traceId,
						spanId: randomSpanId(),
						name: `tool/${pending.toolName}`,
						kind: "tool",
						startedAt: pending.startedAt,
						endedAt: timestamp,
						durationMs,
						toolName: pending.toolName,
						inputSummary: pending.inputSummary,
						attributes: { tool_use_id: toolUseId },
					});
				} else {
					// No pending decision found, create standalone
					const toolName = (attrs.tool_name as string) ?? "unknown";
					await provider.createSpan({
						traceId,
						spanId: randomSpanId(),
						name: `tool/${toolName}`,
						kind: "tool",
						startedAt: timestamp,
						endedAt: timestamp,
						durationMs,
						toolName,
						inputSummary: extractToolInput(attrs.tool_parameters),
						attributes: { tool_use_id: toolUseId },
					});
				}
				spanCount++;

				// Rolling tool count on trace
				getDb().query("UPDATE traces SET total_tool_calls = total_tool_calls + 1 WHERE trace_id = ?").run(pending?.traceId ?? traceId);

				break;
			}

			// Skip hook_execution events for now (internal plumbing)
			case "claude_code.hook_execution_start":
			case "claude_code.hook_execution_complete":
				break;

			default:
				// Store unknown event types as generic spans
				if (eventType.startsWith("claude_code.")) {
					await provider.createSpan({
						traceId,
						spanId: randomSpanId(),
						name: eventType.replace("claude_code.", ""),
						kind: "notification",
						startedAt: timestamp,
						endedAt: timestamp,
						attributes: attrs,
					});
					spanCount++;
				}
				break;
		}
	}

	return { spans: spanCount, traces: newTraces.size };
}

// Cleanup stale pending tools (older than 10 minutes)
export function cleanupPendingTools(): void {
	const cutoff = Date.now() - 10 * 60 * 1000;
	for (const [id, pending] of pendingTools) {
		if (new Date(pending.startedAt).getTime() < cutoff) {
			pendingTools.delete(id);
		}
	}
}
