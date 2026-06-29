#!/usr/bin/env bun
/**
 * Backfill JSONL logs from ~/.claude/logs/ into the HUSK telemetry schema via API.
 *
 * Usage:
 *   bun run server/src/backfill.ts [--logs-dir ~/.claude/logs] [--url http://localhost:3000] [--key husk_xxx]
 *
 * Credentials fall back to HUSK_URL/HUSK_KEY env vars or ~/.husk/credentials.json.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

// ── CLI args ────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
	options: {
		"logs-dir": { type: "string", default: join(homedir(), ".claude", "logs") },
		url: { type: "string" },
		key: { type: "string" },
	},
	strict: false,
});

const logsDir = args["logs-dir"] as string;

function resolveCredentials(): { url: string; key: string } {
	let url = (args.url as string) ?? process.env.HUSK_URL ?? null;
	let key = (args.key as string) ?? process.env.HUSK_KEY ?? null;

	if (!url || !key) {
		const credPath = join(homedir(), ".husk", "credentials.json");
		if (existsSync(credPath)) {
			try {
				const creds = JSON.parse(readFileSync(credPath, "utf-8")) as {
					url?: string;
					apiKey?: string;
				};
				url = url ?? creds.url ?? null;
				key = key ?? creds.apiKey ?? null;
			} catch {
				// Invalid credentials file
			}
		}
	}

	if (!url || !key) {
		console.error("Error: HUSK server URL and API key required.");
		console.error(
			"  --url <url> --key <key>, or set HUSK_URL/HUSK_KEY, or configure ~/.husk/credentials.json",
		);
		process.exit(1);
	}

	return { url, key };
}

const { url: serverUrl, key: apiKey } = resolveCredentials();

// ── Trace ID derivation (must match packages/telemetry-core/src/spans.ts) ──

function generateTraceId(sessionId: string): string {
	// Must match packages/telemetry-core/src/spans.ts
	const hash = new Bun.CryptoHasher("sha256").update(sessionId).digest("hex");
	return hash.slice(0, 32);
}

function randomHex(bytes: number): string {
	const arr = new Uint8Array(bytes);
	crypto.getRandomValues(arr);
	return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── API helpers ─────────────────────────────────────────────────────────────

const headers = {
	"Content-Type": "application/json",
	Authorization: `Bearer ${apiKey}`,
};

async function postTraces(body: Record<string, unknown>): Promise<boolean> {
	try {
		const resp = await fetch(`${serverUrl}/telemetry/ingest/traces`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(10000),
		});
		return resp.ok;
	} catch {
		return false;
	}
}

interface SpanPayload {
	trace_id: string;
	span_id: string;
	parent_span_id?: string | null;
	name: string;
	kind: string;
	status?: string;
	started_at: string;
	ended_at?: string | null;
	duration_ms?: number | null;
	tool_name?: string | null;
	input_summary?: string | null;
	exit_code?: number | null;
	output_size?: number | null;
	model?: string | null;
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_read_tokens?: number | null;
	cache_create_tokens?: number | null;
	cost_usd?: number | null;
	attributes?: Record<string, unknown> | null;
}

async function postSpanBatch(spans: SpanPayload[]): Promise<number> {
	if (spans.length === 0) return 0;
	try {
		const resp = await fetch(`${serverUrl}/telemetry/ingest/spans`, {
			method: "POST",
			headers,
			body: JSON.stringify({ spans }),
			signal: AbortSignal.timeout(30000),
		});
		if (!resp.ok) return 0;
		const data = (await resp.json()) as { created: number };
		return data.created;
	} catch {
		return 0;
	}
}

// ── JSONL reader ────────────────────────────────────────────────────────────

interface JsonlRecord {
	timestamp?: string;
	event?: string;
	session_id?: string;
	project?: string;
	git_branch?: string;
	model?: string;
	agent_type?: string;
	[key: string]: unknown;
}

async function readJsonlFiles(prefix: string): Promise<JsonlRecord[]> {
	const records: JsonlRecord[] = [];
	let errors = 0;

	const files = readdirSync(logsDir)
		.filter((f) => f.startsWith(prefix) && f.endsWith(".jsonl"))
		.sort();

	for (const file of files) {
		const text = await Bun.file(join(logsDir, file)).text();
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			try {
				records.push(JSON.parse(line) as JsonlRecord);
			} catch {
				errors++;
			}
		}
	}

	if (errors > 0) {
		console.log(`  ⚠ ${errors} malformed lines skipped in ${prefix}*.jsonl`);
	}
	return records;
}

// ── Span batch helper ───────────────────────────────────────────────────────

const BATCH_SIZE = 200;
let spanBuffer: SpanPayload[] = [];

async function bufferSpan(span: SpanPayload): Promise<void> {
	spanBuffer.push(span);
	if (spanBuffer.length >= BATCH_SIZE) {
		await flushSpans();
	}
}

async function flushSpans(): Promise<number> {
	if (spanBuffer.length === 0) return 0;
	const batch = spanBuffer;
	spanBuffer = [];
	return postSpanBatch(batch);
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log(`Backfill: ${logsDir} → ${serverUrl}`);

// Verify server is reachable
try {
	const resp = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(5000) });
	if (!resp.ok) throw new Error(`Health check failed: ${resp.status}`);
	console.log("  Server is healthy");
} catch (err) {
	console.error(`Error: Cannot reach server at ${serverUrl}`);
	process.exit(1);
}

console.log();

const stats = {
	traces: 0,
	turns: 0,
	tools: 0,
	subagents: 0,
	prompts: 0,
	skills: 0,
	compactions: 0,
	permissions: 0,
	notifications: 0,
};

// ── Phase 1: Sessions → Traces ─────────────────────────────────────────────

console.log("Phase 1: Importing sessions → traces...");

const sessionRecords = await readJsonlFiles("sessions-");
const sessionStarts = new Map<string, JsonlRecord>();
const sessionEnds = new Map<string, JsonlRecord>();

for (const rec of sessionRecords) {
	if (!rec.session_id) continue;
	if (rec.event === "session_start") sessionStarts.set(rec.session_id, rec);
	if (rec.event === "session_end") sessionEnds.set(rec.session_id, rec);
}

const allSessionIds = new Set([...sessionStarts.keys(), ...sessionEnds.keys()]);
const createdTraces = new Set<string>();

for (const sessionId of allSessionIds) {
	const traceId = generateTraceId(sessionId);
	const start = sessionStarts.get(sessionId);
	const end = sessionEnds.get(sessionId);

	const usage = (end?.usage ?? {}) as Record<string, number>;
	const ok = await postTraces({
		trace_id: traceId,
		project: start?.project ?? end?.project ?? null,
		git_branch: start?.git_branch ?? end?.git_branch ?? null,
		model: (start?.model as string) || (end?.model as string) || null,
		agent_type: (start?.agent_type as string) || (end?.agent_type as string) || null,
		started_at: start?.timestamp ?? end?.timestamp,
	});

	if (ok) {
		createdTraces.add(traceId);
		stats.traces++;

		// If we have end data, close the trace with totals
		if (end) {
			await postTraces({
				trace_id: traceId,
				action: "end",
				totals: {
					total_input_tokens: usage.input_tokens ?? 0,
					total_output_tokens: usage.output_tokens ?? 0,
					total_cache_read_tokens: usage.cache_read_input_tokens ?? 0,
					total_cache_create_tokens: usage.cache_creation_input_tokens ?? 0,
					total_cost_usd: (end.estimated_cost_usd as number) ?? 0,
					total_turns: (end.turn_count as number) ?? 0,
					total_tool_calls: (end.tool_count as number) ?? 0,
					total_tool_failures: 0,
				},
			});
		}
	}
}

console.log(`  ✓ ${stats.traces} traces created`);

// ── Phase 2: Turns → Spans ──────────────────────────────────────────────────

console.log("Phase 2: Importing turns → spans...");

const turnRecords = await readJsonlFiles("turns-");

for (const rec of turnRecords) {
	if (!rec.session_id || rec.event !== "turn") continue;
	const traceId = generateTraceId(rec.session_id);
	if (!createdTraces.has(traceId)) continue;

	const usage = (rec.usage ?? {}) as Record<string, number>;
	await bufferSpan({
		trace_id: traceId,
		span_id: randomHex(8),
		name: `turn/${(rec.turn_number as number) ?? 0}`,
		kind: "turn",
		started_at: rec.timestamp ?? new Date().toISOString(),
		model: (rec.model as string) || null,
		input_tokens: usage.input_tokens ?? null,
		output_tokens: usage.output_tokens ?? null,
		cache_read_tokens: usage.cache_read_input_tokens ?? null,
		cache_create_tokens: usage.cache_creation_input_tokens ?? null,
		cost_usd: (rec.estimated_cost_usd as number) ?? null,
		attributes: { tool_count: rec.tool_count ?? 0, tool_failures: rec.tool_failures ?? 0 },
	});
	stats.turns++;
}
await flushSpans();
console.log(`  ✓ ${stats.turns} turn spans created`);

// ── Phase 3: Tool usage → Spans ─────────────────────────────────────────────

console.log("Phase 3: Importing tool-usage → spans...");

const toolRecords = await readJsonlFiles("tool-usage-");
// Track pre events by tool_use_id so we can create spans for unmatched ones
const preEvents = new Map<string, JsonlRecord>();
let unmatchedPreCount = 0;

for (const rec of toolRecords) {
	if (!rec.session_id) continue;
	const toolUseId = rec.tool_use_id as string;

	if (rec.event === "pre") {
		if (toolUseId) preEvents.set(toolUseId, rec);
		continue;
	}
	if (rec.event !== "post" && rec.event !== "tool_failure") continue;

	const traceId = generateTraceId(rec.session_id);
	if (!createdTraces.has(traceId)) continue;

	const preRec = toolUseId ? preEvents.get(toolUseId) : undefined;
	const startedAt = preRec?.timestamp || rec.timestamp || new Date().toISOString();

	await bufferSpan({
		trace_id: traceId,
		span_id: randomHex(8),
		name: `tool/${(rec.tool_name as string) ?? "unknown"}`,
		kind: "tool",
		status: rec.event === "tool_failure" ? "error" : "ok",
		started_at: startedAt,
		ended_at: rec.timestamp ?? null,
		duration_ms: rec.duration_ms != null ? Number(rec.duration_ms) : null,
		tool_name: (rec.tool_name as string) ?? null,
		input_summary: (rec.input_summary as string)?.slice(0, 500) ?? null,
		exit_code: rec.exit_code != null ? Number(rec.exit_code) : null,
		output_size: rec.output_size != null ? Number(rec.output_size) : null,
	});

	if (toolUseId) preEvents.delete(toolUseId);
	stats.tools++;
}

// Create spans for pre events that never got a post/failure (common for MCP tools)
for (const [, preRec] of preEvents) {
	if (!preRec.session_id) continue;
	const traceId = generateTraceId(preRec.session_id);
	if (!createdTraces.has(traceId)) continue;

	await bufferSpan({
		trace_id: traceId,
		span_id: randomHex(8),
		name: `tool/${(preRec.tool_name as string) ?? "unknown"}`,
		kind: "tool",
		status: "ok",
		started_at: preRec.timestamp ?? new Date().toISOString(),
		tool_name: (preRec.tool_name as string) ?? null,
		input_summary: (preRec.input_summary as string)?.slice(0, 500) ?? null,
	});
	unmatchedPreCount++;
	stats.tools++;
}

await flushSpans();
console.log(
	`  ✓ ${stats.tools} tool spans created (${unmatchedPreCount} from unmatched pre events)`,
);

// ── Phase 4: Subagents → Spans ──────────────────────────────────────────────

console.log("Phase 4: Importing subagents → spans...");

const subagentRecords = await readJsonlFiles("subagents-");
const subagentStarts = new Map<string, JsonlRecord>();

for (const rec of subagentRecords) {
	if (!rec.session_id) continue;
	const agentId = rec.agent_id as string;

	if (rec.event === "subagent_start") {
		if (agentId) subagentStarts.set(agentId, rec);
		continue;
	}
	if (rec.event !== "subagent_stop") continue;

	const traceId = generateTraceId(rec.session_id);
	if (!createdTraces.has(traceId)) continue;

	const start = agentId ? subagentStarts.get(agentId) : undefined;
	const usage = (rec.usage ?? {}) as Record<string, number>;

	await bufferSpan({
		trace_id: traceId,
		span_id: randomHex(8),
		name: `subagent/${(rec.agent_type as string) ?? agentId ?? "unknown"}`,
		kind: "subagent",
		started_at: start?.timestamp ?? rec.timestamp ?? new Date().toISOString(),
		ended_at: rec.timestamp ?? null,
		duration_ms: rec.duration_ms != null ? Number(rec.duration_ms) : null,
		input_tokens: usage.input_tokens ?? null,
		output_tokens: usage.output_tokens ?? null,
		cache_read_tokens: usage.cache_read_input_tokens ?? null,
		cache_create_tokens: usage.cache_creation_input_tokens ?? null,
		cost_usd: (rec.estimated_cost_usd as number) ?? null,
		attributes: { agent_id: agentId, agent_type: rec.agent_type },
	});

	if (agentId) subagentStarts.delete(agentId);
	stats.subagents++;
}
await flushSpans();
console.log(`  ✓ ${stats.subagents} subagent spans created`);

// ── Phase 5: Prompts → Spans ────────────────────────────────────────────────

console.log("Phase 5: Importing prompts → spans...");
const promptRecords = await readJsonlFiles("prompts-");

for (const rec of promptRecords) {
	if (!rec.session_id) continue;
	const traceId = generateTraceId(rec.session_id);
	if (!createdTraces.has(traceId)) continue;

	const prompt = (rec.prompt as string) ?? "";
	await bufferSpan({
		trace_id: traceId,
		span_id: randomHex(8),
		name: "prompt",
		kind: "prompt",
		started_at: rec.timestamp ?? new Date().toISOString(),
		input_summary: prompt.slice(0, 2000),
		attributes: { length_chars: rec.length_chars ?? prompt.length },
	});
	stats.prompts++;
}
await flushSpans();
console.log(`  ✓ ${stats.prompts} prompt spans created`);

// ── Phase 6: Skills → Spans ─────────────────────────────────────────────────

console.log("Phase 6: Importing skills → spans...");
const skillRecords = await readJsonlFiles("skills-");

for (const rec of skillRecords) {
	if (!rec.session_id) continue;
	const traceId = generateTraceId(rec.session_id);
	if (!createdTraces.has(traceId)) continue;

	await bufferSpan({
		trace_id: traceId,
		span_id: randomHex(8),
		name: `skill/${(rec.skill as string) ?? "unknown"}`,
		kind: "skill",
		started_at: rec.timestamp ?? new Date().toISOString(),
		input_summary: (rec.args as string)?.slice(0, 500) ?? null,
		attributes: { skill: rec.skill, args: rec.args },
	});
	stats.skills++;
}
await flushSpans();
console.log(`  ✓ ${stats.skills} skill spans created`);

// ── Phase 7: Lifecycle events → Spans ───────────────────────────────────────

console.log("Phase 7: Importing lifecycle events → spans...");

const lifecycleCategories = [
	{ prefix: "compactions-", kind: "compaction", key: "compactions" },
	{ prefix: "permissions-", kind: "permission", key: "permissions" },
	{ prefix: "notifications-", kind: "notification", key: "notifications" },
];

for (const cat of lifecycleCategories) {
	const records = await readJsonlFiles(cat.prefix);
	let count = 0;

	for (const rec of records) {
		if (!rec.session_id) continue;
		const traceId = generateTraceId(rec.session_id);
		if (!createdTraces.has(traceId)) continue;

		const name =
			cat.kind === "notification"
				? ((rec.notification_type as string) ?? "notification")
				: cat.kind === "permission"
					? ((rec.event as string) ?? "permission")
					: cat.kind;

		await bufferSpan({
			trace_id: traceId,
			span_id: randomHex(8),
			name,
			kind: cat.kind,
			status: rec.event === "permission_denied" ? "error" : "ok",
			started_at: rec.timestamp ?? new Date().toISOString(),
			tool_name: cat.kind === "permission" ? ((rec.tool_name as string) ?? null) : null,
			input_summary:
				cat.kind === "permission"
					? ((rec.tool_name as string) ?? null)
					: cat.kind === "notification"
						? ((rec.title as string)?.slice(0, 500) ?? null)
						: null,
			attributes: { event: rec.event, ...rec },
		});
		count++;
	}
	await flushSpans();
	(stats as Record<string, number>)[cat.key] = count;
	console.log(`  ✓ ${count} ${cat.kind} spans created`);
}

// ── Summary ─────────────────────────────────────────────────────────────────

console.log();
console.log("Backfill complete:");
console.log(`  Traces:        ${stats.traces}`);
console.log(`  Turn spans:    ${stats.turns}`);
console.log(`  Tool spans:    ${stats.tools}`);
console.log(`  Subagent spans: ${stats.subagents}`);
console.log(`  Prompt spans:  ${stats.prompts}`);
console.log(`  Skill spans:   ${stats.skills}`);
console.log(`  Compaction spans: ${stats.compactions}`);
console.log(`  Permission spans: ${stats.permissions}`);
console.log(`  Notification spans: ${stats.notifications}`);

const totalSpans =
	stats.turns +
	stats.tools +
	stats.subagents +
	stats.prompts +
	stats.skills +
	stats.compactions +
	stats.permissions +
	stats.notifications;
console.log(`  Total:         ${stats.traces} traces, ${totalSpans} spans`);
