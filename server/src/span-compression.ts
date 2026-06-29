import { getLogger } from "@logtape/logtape";
import { getCompressionProvider, parseStructuredCompression } from "./compression.js";
import type { ExtractedKnowledge, StructuredCompression } from "./compression.js";
import { getDb } from "./db.js";

const EXTRACT_ONLY_PROMPT = `Extract reusable knowledge from this session summary. Return YAML only:

---
extracted:
  - type: decision
    content: Chose X over Y because Z
  - type: fact
    content: The API uses nested response structure under geo, network, threat
---

Rules:
- type is one of: decision, lesson, fact
- Each item must be self-contained and useful without the session context
- 0-5 items. Skip trivial observations.
- Return just the YAML block, nothing else.

Summary:`;

function parseExtractOnly(raw: string): ExtractedKnowledge[] {
	const cleaned = raw
		.replace(/^```(?:yaml|yml)?\s*\n?/i, "")
		.replace(/\n?```\s*$/i, "")
		.trim();
	const validTypes = new Set(["decision", "lesson", "fact"]);
	const extracted: ExtractedKnowledge[] = [];
	const itemRegex = /-\s*type:\s*(\w+)\s*\n\s*content:\s*(.+?)(?=\n\s*-\s*type:|\n---|\n*$)/gs;
	for (const match of cleaned.matchAll(itemRegex)) {
		const type = match[1]?.trim() ?? "";
		const content = match[2]?.replace(/^["']|["']$/g, "").trim() ?? "";
		if (validTypes.has(type) && content.length > 10) {
			extracted.push({ type: type as ExtractedKnowledge["type"], content });
		}
	}
	return extracted.slice(0, 5);
}
import { getGraphProviderOrNull } from "./graph.js";
import { isDuplicate, storeMemory } from "./ingest.js";
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
			const attrs = span.attributes ? (JSON.parse(span.attributes) as Record<string, unknown>) : {};
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

		const rawResponse = await provider.summarizeStructured(formatted);
		let structured = parseStructuredCompression(rawResponse);

		const summary = structured?.summary ?? rawResponse;
		const title = structured?.title ?? null;

		// Second pass: if the first pass didn't extract knowledge, try a focused extraction
		if (!structured?.extracted.length && summary.length > 100) {
			try {
				const extractRaw = await provider.complete(
					`${EXTRACT_ONLY_PROMPT}\n\n${summary.slice(0, 4000)}`,
					500,
				);
				const items = parseExtractOnly(extractRaw);
				if (items.length > 0) {
					structured = { title: title ?? summary.slice(0, 80), summary, extracted: items };
					log.info("Second-pass extraction found {count} items for trace {id}", {
						count: items.length,
						id: trace.trace_id,
					});
				}
			} catch (err) {
				log.warn("Second-pass extraction failed for trace {id}: {error}", {
					id: trace.trace_id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		const db = getDb();
		db.query(
			"UPDATE traces SET summary = ?, last_compressed_at = datetime('now') WHERE trace_id = ?",
		).run(summary, trace.trace_id);

		const apiKey = db
			.query<{ id: string; label: string; user_id: string }, [string]>(
				"SELECT id, label, user_id FROM api_keys WHERE id = ?",
			)
			.get(trace.api_key_id);

		if (!apiKey) return summary;

		const traceMetadata = {
			source: "trace_compression",
			trace_id: trace.trace_id,
			started_at: trace.started_at,
			ended_at: trace.ended_at,
			model: trace.model,
			total_cost_usd: trace.total_cost_usd,
			total_turns: trace.total_turns,
			total_tool_calls: trace.total_tool_calls,
		};

		let sessionMemoryId: string | null = null;

		try {
			const result = await storeMemory({
				summary,
				apiKeyId: apiKey.id,
				apiKeyLabel: apiKey.label,
				userId: apiKey.user_id,
				gitRemote: trace.project,
				scope: "session",
				memoryType: "session",
				title: title ?? undefined,
				metadata: traceMetadata,
				force: true,
			});

			if (!isDuplicate(result)) {
				sessionMemoryId = result.id;
			}
		} catch (err) {
			log.warn("Failed to store trace summary as memory: {error}", {
				error: err instanceof Error ? err.message : String(err),
			});
		}

		if (structured?.extracted.length && sessionMemoryId) {
			const graphProvider = getGraphProviderOrNull();

			for (const item of structured.extracted) {
				try {
					const result = await storeMemory({
						summary: item.content,
						apiKeyId: apiKey.id,
						apiKeyLabel: apiKey.label,
						userId: apiKey.user_id,
						gitRemote: trace.project,
						scope: "project",
						memoryType: item.type,
						metadata: {
							source: "trace_extraction",
							trace_id: trace.trace_id,
							session_memory_id: sessionMemoryId,
						},
					});

					if (!isDuplicate(result) && graphProvider) {
						try {
							await graphProvider.addEdge({
								sourceMemoryId: result.id,
								targetMemoryId: sessionMemoryId,
								edgeType: "derived_from",
								userId: apiKey.user_id,
							});
						} catch {
							// Edge creation is non-fatal
						}
					}
				} catch (err) {
					log.warn("Failed to store extracted memory: {error}", {
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}

			log.info("Extracted {count} knowledge items from trace {id}", {
				count: structured.extracted.length,
				id: trace.trace_id,
			});
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
