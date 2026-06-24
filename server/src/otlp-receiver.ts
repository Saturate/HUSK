import { getLogger } from "@logtape/logtape";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { bearerKeyMiddleware } from "./auth.js";
import { calculateCost } from "./cost.js";
import { getDb } from "./db.js";
import type { AppEnv } from "./env.js";
import type { SpanKind } from "./telemetry.js";
import { getTelemetryProviderOrNull } from "./telemetry.js";

const log = getLogger(["husk", "otlp"]);

// --- OTLP JSON types (simplified) ---

interface OtlpAttribute {
	key: string;
	value: {
		stringValue?: string;
		intValue?: string | number;
		doubleValue?: number;
		boolValue?: boolean;
		arrayValue?: { values: Array<{ stringValue?: string }> };
	};
}

interface OtlpSpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: number;
	startTimeUnixNano: string;
	endTimeUnixNano?: string;
	status?: { code?: number; message?: string };
	attributes?: OtlpAttribute[];
}

interface OtlpScopeSpans {
	spans: OtlpSpan[];
}

interface OtlpResourceSpans {
	resource?: { attributes?: OtlpAttribute[] };
	scopeSpans: OtlpScopeSpans[];
}

interface OtlpTraceRequest {
	resourceSpans: OtlpResourceSpans[];
}

// --- Helpers ---

function parseOtlpAttributes(attrs?: OtlpAttribute[]): Record<string, unknown> {
	if (!attrs) return {};
	const result: Record<string, unknown> = {};
	for (const attr of attrs) {
		const v = attr.value;
		if (v.stringValue !== undefined) result[attr.key] = v.stringValue;
		else if (v.intValue !== undefined) result[attr.key] = Number(v.intValue);
		else if (v.doubleValue !== undefined) result[attr.key] = v.doubleValue;
		else if (v.boolValue !== undefined) result[attr.key] = v.boolValue;
		else if (v.arrayValue) {
			result[attr.key] = v.arrayValue.values.map((v) => v.stringValue ?? "");
		}
	}
	return result;
}

function nanoToIso(nano: string | undefined): string | null {
	if (!nano || nano === "0") return null;
	const ms = Number(BigInt(nano) / 1_000_000n);
	return new Date(ms).toISOString();
}

function nanoDiffMs(startNano: string, endNano: string | undefined): number | null {
	if (!endNano || endNano === "0") return null;
	return Number((BigInt(endNano) - BigInt(startNano)) / 1_000_000n);
}

function deriveSpanKind(name: string, attrs: Record<string, unknown>): SpanKind {
	const explicit = attrs["husk.span.kind"] as string | undefined;
	if (explicit) return explicit as SpanKind;

	if (name.startsWith("turn/") || name === "turn") return "turn";
	if (name.startsWith("tool/")) return "tool";
	if (name.startsWith("subagent/")) return "subagent";
	if (name.startsWith("skill/")) return "skill";
	if (name === "prompt" || name.startsWith("prompt")) return "prompt";
	if (name.includes("compact")) return "compaction";
	if (name.includes("permission")) return "permission";
	if (name.includes("notification")) return "notification";

	// GenAI convention: chat spans are turns
	if (attrs["gen_ai.operation.name"] === "chat") return "turn";
	// Tool execution spans
	if (attrs["tool.name"]) return "tool";

	return "tool";
}

function extractDomainFields(attrs: Record<string, unknown>) {
	return {
		model:
			(attrs["gen_ai.request.model"] as string) ??
			(attrs["llm.model"] as string) ??
			(attrs["model"] as string) ??
			null,
		toolName:
			(attrs["tool.name"] as string) ??
			(attrs["husk.tool_name"] as string) ??
			null,
		inputSummary:
			(attrs["husk.input_summary"] as string) ??
			(attrs["gen_ai.prompt"] as string)?.slice(0, 2000) ??
			null,
		inputTokens:
			(attrs["gen_ai.usage.input_tokens"] as number) ??
			(attrs["llm.usage.prompt_tokens"] as number) ??
			null,
		outputTokens:
			(attrs["gen_ai.usage.output_tokens"] as number) ??
			(attrs["llm.usage.completion_tokens"] as number) ??
			null,
		cacheReadTokens: (attrs["gen_ai.usage.cache_read_tokens"] as number) ?? null,
		cacheCreateTokens: (attrs["gen_ai.usage.cache_create_tokens"] as number) ?? null,
		exitCode: (attrs["process.exit_code"] as number) ?? null,
		outputSize: (attrs["husk.output_size"] as number) ?? null,
		linkedTraceId: (attrs["husk.linked_trace_id"] as string) ?? null,
		project:
			(attrs["husk.project"] as string) ??
			(attrs["project.name"] as string) ??
			null,
		gitBranch:
			(attrs["husk.git_branch"] as string) ??
			(attrs["vcs.branch"] as string) ??
			null,
		agentType:
			(attrs["husk.agent_type"] as string) ??
			(attrs["agent.type"] as string) ??
			null,
	};
}

// --- Router ---

export const otlpReceiver = new Hono<AppEnv>();

// Conditional auth: skip bearer check when HUSK_OTLP_AUTH=false
otlpReceiver.use("/v1/*", async (c, next) => {
	const authRequired = process.env.HUSK_OTLP_AUTH !== "false";
	if (!authRequired) return next();
	return bearerKeyMiddleware(c, next);
});

otlpReceiver.post("/v1/traces", async (c) => {
	const provider = getTelemetryProviderOrNull();
	if (!provider) return c.json({}, 503);

	let body: OtlpTraceRequest;
	try {
		body = (await c.req.json()) as OtlpTraceRequest;
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}

	if (!body.resourceSpans?.length) {
		log.warn("No resourceSpans in OTLP body");
		return c.json({});
	}

	let apiKeyId = c.get("apiKey")?.id;
	if (!apiKeyId) {
		const row = getDb()
			.query<{ id: string }, []>("SELECT id FROM api_keys WHERE is_active = 1 LIMIT 1")
			.get();
		apiKeyId = row?.id ?? "otlp-anonymous";
	}
	log.info("OTLP: {count} resourceSpans, apiKeyId={key}", {
		count: body.resourceSpans.length,
		key: apiKeyId,
	});
	const seenTraces = new Set<string>();
	let spanCount = 0;

	for (const rs of body.resourceSpans) {
		const resourceAttrs = parseOtlpAttributes(rs.resource?.attributes);
		const serviceName = (resourceAttrs["service.name"] as string) ?? null;

		for (const ss of rs.scopeSpans) {
			for (const span of ss.spans) {
				const traceId = span.traceId;
				const attrs = parseOtlpAttributes(span.attributes);
				const domain = extractDomainFields(attrs);

				// Auto-create trace on first span
				if (!seenTraces.has(traceId)) {
					seenTraces.add(traceId);
					const existing = await provider.getTrace(traceId);
					if (!existing) {
						try {
							await provider.startTrace({
								traceId,
								apiKeyId,
								project: domain.project ?? serviceName,
								gitBranch: domain.gitBranch,
								model: domain.model,
								agentType: domain.agentType,
								startedAt: nanoToIso(span.startTimeUnixNano) ?? new Date().toISOString(),
							});
						} catch (err) {
							log.error("Trace creation failed for {id}: {error}", {
								id: traceId,
								error: err instanceof Error ? err.message : String(err),
							});
						}
					}
				}

				const kind = deriveSpanKind(span.name, attrs);
				const startedAt = nanoToIso(span.startTimeUnixNano) ?? new Date().toISOString();
				const endedAt = nanoToIso(span.endTimeUnixNano);
				const durationMs = nanoDiffMs(span.startTimeUnixNano, span.endTimeUnixNano);
				const statusCode = span.status?.code ?? 0;
				const status = statusCode === 2 ? "error" : "ok";

				let costUsd: number | null = null;
				if (domain.model && domain.inputTokens && domain.outputTokens) {
					costUsd = calculateCost({
						model: domain.model,
						inputTokens: domain.inputTokens,
						outputTokens: domain.outputTokens,
						cacheReadTokens: domain.cacheReadTokens ?? 0,
						cacheCreateTokens: domain.cacheCreateTokens ?? 0,
					});
				}

				// Strip domain fields from attributes to avoid duplication
				const remainingAttrs = { ...attrs };
				for (const key of [
					"gen_ai.request.model", "llm.model", "model",
					"tool.name", "husk.tool_name",
					"husk.input_summary", "gen_ai.prompt",
					"gen_ai.usage.input_tokens", "llm.usage.prompt_tokens",
					"gen_ai.usage.output_tokens", "llm.usage.completion_tokens",
					"gen_ai.usage.cache_read_tokens", "gen_ai.usage.cache_create_tokens",
					"process.exit_code", "husk.output_size",
					"husk.linked_trace_id", "husk.span.kind",
					"husk.project", "project.name",
					"husk.git_branch", "vcs.branch",
					"husk.agent_type", "agent.type",
				]) {
					delete remainingAttrs[key];
				}

				try {
					await provider.createSpan({
						traceId,
						spanId: span.spanId,
						parentSpanId: span.parentSpanId || null,
						name: span.name,
						kind,
						startedAt,
						endedAt,
						durationMs,
						toolName: domain.toolName,
						inputSummary: domain.inputSummary,
						exitCode: domain.exitCode,
						outputSize: domain.outputSize,
						model: domain.model,
						inputTokens: domain.inputTokens,
						outputTokens: domain.outputTokens,
						cacheReadTokens: domain.cacheReadTokens,
						cacheCreateTokens: domain.cacheCreateTokens,
						costUsd,
						attributes: Object.keys(remainingAttrs).length > 0 ? remainingAttrs : null,
						linkedTraceId: domain.linkedTraceId,
					});
					spanCount++;
				} catch (err) {
					log.warn("Failed to create span {id}: {error}", {
						id: span.spanId,
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}
		}
	}

	log.info("OTLP ingested {spans} spans across {traces} traces", {
		spans: spanCount,
		traces: seenTraces.size,
	});

	return c.json({});
});

// Accept OTLP logs - Claude Code sends telemetry as logs too
otlpReceiver.post("/v1/logs", async (c) => {
	const ct = c.req.header("content-type") ?? "unknown";
	try {
		const raw = await c.req.text();
		const logFile = join(tmpdir(), "husk-otlp-logs-sample.bin");
		await Bun.write(logFile, raw);
		log.info("OTLP logs received, content-type={ct}, size={size}, saved to {file}", { ct, size: raw.length, file: logFile });
	} catch (err) {
		log.info("OTLP logs received, content-type={ct}, error={error}", { ct, error: err instanceof Error ? err.message : String(err) });
	}
	return c.json({});
});

// Accept OTLP metrics
otlpReceiver.post("/v1/metrics", async (c) => {
	log.info("OTLP metrics received");
	return c.json({});
});
