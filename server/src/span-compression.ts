import { getLogger } from "@logtape/logtape";
import { getDb } from "./db.js";
import { getCompressionProvider } from "./compression.js";
import { storeMemory } from "./ingest.js";
import type { SpanRow, TraceRow } from "./telemetry.js";
import { getTelemetryProviderOrNull } from "./telemetry.js";

const log = getLogger(["husk", "span-compression"]);

// Span kinds that carry knowledge value for session summaries
const KNOWLEDGE_KINDS = new Set(["prompt", "tool", "subagent", "skill"]);

// Tools to exclude - pure reads and internal bookkeeping
const EXCLUDED_TOOLS = new Set([
	"Read",
	"Grep",
	"Glob",
	"ToolSearch",
	"TaskCreate",
	"TaskUpdate",
	"TaskGet",
	"TaskList",
	"TaskStop",
	"TaskOutput",
	"SendMessage",
	"ListMcpResourcesTool",
	"ReadMcpResourceTool",
	"ReadMcpResourceDirTool",
	"Monitor",
	"ScheduleWakeup",
	"PushNotification",
	"CronCreate",
	"CronDelete",
	"CronList",
]);

export function getKnowledgeSpans(traceId: string, since?: string | null): SpanRow[] {
	const db = getDb();

	const conditions = ["trace_id = ?"];
	const params: (string | number)[] = [traceId];

	if (since) {
		conditions.push("started_at > ?");
		params.push(since);
	}

	const rows = db
		.query<SpanRow, (string | number)[]>(
			`SELECT * FROM spans WHERE ${conditions.join(" AND ")} ORDER BY started_at ASC`,
		)
		.all(...params);

	return rows.filter((span) => {
		if (!KNOWLEDGE_KINDS.has(span.kind)) return false;
		if (span.kind === "tool" && span.tool_name && EXCLUDED_TOOLS.has(span.tool_name)) return false;
		return true;
	});
}

const MAX_COMPRESSION_TEXT = 12_000;

export function formatSpansForCompression(spans: SpanRow[], project: string | null): string {
	const header = project ? `Project: ${project}\n\n` : "";
	const lines: string[] = [];

	for (const span of spans) {
		if (span.kind === "prompt") {
			const text = span.input_summary?.slice(0, 500) ?? "";
			lines.push(`[User] ${text}`);
		} else if (span.kind === "tool") {
			const status = span.status === "error" ? " ERROR" : "";
			const duration = span.duration_ms ? ` ${span.duration_ms}ms` : "";
			const summary = span.input_summary?.slice(0, 300) ?? "";
			lines.push(`[${span.tool_name ?? "tool"}${status}${duration}] ${summary}`);
		} else if (span.kind === "subagent") {
			const attrs = span.attributes ? JSON.parse(span.attributes) as Record<string, unknown> : {};
			const agentType = (attrs.agent_type as string) ?? "agent";
			const duration = span.duration_ms ? ` ${span.duration_ms}ms` : "";
			const cost = span.cost_usd ? ` $${span.cost_usd.toFixed(2)}` : "";
			lines.push(`[Subagent: ${agentType}${duration}${cost}]`);
		} else if (span.kind === "skill") {
			const summary = span.input_summary?.slice(0, 200) ?? "";
			lines.push(`[Skill: ${span.name}] ${summary}`);
		}
	}

	let text = header + lines.join("\n");
	if (text.length > MAX_COMPRESSION_TEXT) {
		text = `${text.slice(0, MAX_COMPRESSION_TEXT)}\n...(truncated)`;
	}
	return text;
}

const compressingTraces = new Set<string>();

export async function compressTrace(trace: TraceRow): Promise<string | null> {
	if (compressingTraces.has(trace.trace_id)) return null;
	compressingTraces.add(trace.trace_id);

	try {
		const spans = getKnowledgeSpans(trace.trace_id, trace.last_compressed_at);
		if (spans.length === 0) return null;

		const provider = getCompressionProvider();
		const formatted = formatSpansForCompression(spans, trace.project);

		log.info("Compressing trace {id} ({count} knowledge spans) with {provider}", {
			id: trace.trace_id,
			count: spans.length,
			provider: provider.name,
		});

		const summary = await provider.summarize(
			spans.map((s) => ({
				id: s.id,
				session_id: s.trace_id,
				event: s.kind === "prompt" ? "UserPromptSubmit" : "PostToolUse",
				tool_name: s.tool_name,
				content: formatted,
				compressed: 0,
				created_at: s.started_at,
				prompt: s.kind === "prompt" ? s.input_summary : null,
				tool_input_summary: s.input_summary,
				files_modified: null,
			})),
			trace.project,
		);

		// Store summary on trace
		const db = getDb();
		db.query("UPDATE traces SET summary = ?, last_compressed_at = datetime('now') WHERE trace_id = ?").run(
			summary,
			trace.trace_id,
		);

		// Store as searchable memory
		const apiKey = db
			.query<{ id: string; label: string; user_id: string }, [string]>(
				"SELECT id, label, user_id FROM api_keys WHERE id = ?",
			)
			.get(trace.api_key_id);

		if (apiKey) {
			try {
				await storeMemory({
					summary,
					apiKeyId: apiKey.id,
					apiKeyLabel: apiKey.label,
					userId: apiKey.user_id,
					gitRemote: trace.project,
					scope: "session",
					memoryType: "session",
					metadata: {
						source: "trace_compression",
						trace_id: trace.trace_id,
					},
				});
			} catch (err) {
				log.warn("Failed to store trace summary as memory: {error}", {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		return summary;
	} finally {
		compressingTraces.delete(trace.trace_id);
	}
}

export function getUncompressedTraces(): TraceRow[] {
	const db = getDb();
	return db
		.query<TraceRow, []>(
			"SELECT * FROM traces WHERE status = 'ended' AND summary IS NULL ORDER BY started_at DESC",
		)
		.all();
}

export function getKnowledgeSpanCount(traceId: string, since?: string | null): number {
	const spans = getKnowledgeSpans(traceId, since);
	return spans.length;
}
