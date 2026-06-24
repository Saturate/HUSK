import { getLogger } from "@logtape/logtape";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "./db.js";
import type { SpanRow } from "./telemetry.js";

const log = getLogger(["husk", "secrets"]);

export interface SecretFinding {
	span_id: string;
	trace_id: string;
	span_name: string;
	tool_name: string | null;
	detector: string;
	secret_type: string;
	redacted_match: string;
	verified: boolean;
	field: string;
	started_at: string;
}

// --- Scanner provider interface ---

interface ScanResult {
	secret_type: string;
	detector: string;
	raw_match: string;
	verified: boolean;
}

interface Scanner {
	name: string;
	available: boolean;
	scan(text: string): Promise<ScanResult[]>;
}

// --- TruffleHog scanner (800+ secret types, live verification) ---

class TrufflehogScanner implements Scanner {
	name = "trufflehog";
	available: boolean;

	constructor() {
		try {
			const result = Bun.spawnSync(["trufflehog", "--version"], { stdout: "pipe", stderr: "pipe" });
			this.available = result.exitCode === 0;
		} catch {
			this.available = false;
		}
	}

	async scan(text: string): Promise<ScanResult[]> {
		if (!this.available) return [];

		const tmpFile = join(tmpdir(), `husk-scan-${crypto.randomUUID()}.txt`);
		try {
			await Bun.write(tmpFile, text);

			const proc = Bun.spawn(
				["trufflehog", "filesystem", tmpFile, "--json", "--no-update", "--only-verified=false"],
				{ stdout: "pipe", stderr: "pipe" },
			);

			const output = await new Response(proc.stdout).text();
			await proc.exited;

			const results: ScanResult[] = [];
			for (const line of output.split("\n")) {
				if (!line.trim()) continue;
				try {
					const finding = JSON.parse(line) as {
						DetectorName?: string;
						DecoderName?: string;
						Verified?: boolean;
						Raw?: string;
						RawV2?: string;
						DetectorType?: number;
						SourceMetadata?: unknown;
					};
					results.push({
						secret_type: finding.DetectorName ?? "unknown",
						detector: "trufflehog",
						raw_match: finding.Raw ?? finding.RawV2 ?? "",
						verified: finding.Verified ?? false,
					});
				} catch {
					// Skip malformed output lines
				}
			}
			return results;
		} finally {
			try {
				const { unlinkSync } = await import("node:fs");
				unlinkSync(tmpFile);
			} catch {
				// Cleanup best-effort
			}
		}
	}
}

// --- Builtin regex scanner (fallback, no external deps) ---

interface RegexPattern {
	name: string;
	regex: RegExp;
}

const BUILTIN_PATTERNS: RegexPattern[] = [
	{ name: "AWS Access Key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
	{ name: "OpenAI Key", regex: /\bsk-[a-zA-Z0-9]{20,}/ },
	{ name: "Anthropic Key", regex: /\bsk-ant-[a-zA-Z0-9-]{20,}/ },
	{ name: "GitHub Token", regex: /\bghp_[a-zA-Z0-9]{36}\b/ },
	{ name: "GitHub OAuth", regex: /\bgho_[a-zA-Z0-9]{36}\b/ },
	{ name: "GitLab Token", regex: /\bglpat-[a-zA-Z0-9-]{20,}\b/ },
	{ name: "Slack Token", regex: /\bxox[bsp]-[a-zA-Z0-9-]{10,}/ },
	{ name: "Stripe Key", regex: /\b[sr]k_(live|test)_[a-zA-Z0-9]{20,}/ },
	{ name: "Private Key", regex: /-----BEGIN\s+(RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
	{ name: "JWT Token", regex: /\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\b/ },
	{ name: "Database URL", regex: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@\s]+@[^\s]+/ },
	{ name: "Password Assignment", regex: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{8,}/i },
	{ name: "Secret Assignment", regex: /(?:secret|api_key|apikey|auth_token)\s*[:=]\s*["']?[^\s"']{8,}/i },
];

class BuiltinScanner implements Scanner {
	name = "builtin";
	available = true;

	async scan(text: string): Promise<ScanResult[]> {
		const results: ScanResult[] = [];
		for (const pattern of BUILTIN_PATTERNS) {
			const match = text.match(pattern.regex);
			if (match) {
				results.push({
					secret_type: pattern.name,
					detector: "builtin",
					raw_match: match[0],
					verified: false,
				});
			}
		}
		return results;
	}
}

// --- Scanner factory ---

let scanner: Scanner | null = null;

function getScanner(): Scanner {
	if (scanner) return scanner;

	const th = new TrufflehogScanner();
	if (th.available) {
		log.info("Using trufflehog for secret scanning");
		scanner = th;
	} else {
		log.info("Trufflehog not found, using builtin patterns");
		scanner = new BuiltinScanner();
	}
	return scanner;
}

// --- Redaction ---

function redact(text: string): string {
	if (text.length <= 8) return "***";
	return text.slice(0, 4) + "..." + text.slice(-4);
}

// --- Public API ---

export async function scanSpan(span: SpanRow): Promise<SecretFinding[]> {
	const s = getScanner();
	const findings: SecretFinding[] = [];

	const fields: Array<[string, string | null]> = [
		["input_summary", span.input_summary],
		["attributes", span.attributes],
	];

	for (const [field, text] of fields) {
		if (!text) continue;
		const results = await s.scan(text);
		for (const r of results) {
			findings.push({
				span_id: span.span_id,
				trace_id: span.trace_id,
				span_name: span.name,
				tool_name: span.tool_name,
				detector: r.detector,
				secret_type: r.secret_type,
				redacted_match: redact(r.raw_match),
				verified: r.verified,
				field,
				started_at: span.started_at,
			});
		}
	}

	return findings;
}

export async function scanTrace(traceId: string): Promise<SecretFinding[]> {
	const db = getDb();
	const spans = db
		.query<SpanRow, [string]>("SELECT * FROM spans WHERE trace_id = ?")
		.all(traceId);

	// For trufflehog efficiency: concatenate all span text and scan once
	const s = getScanner();
	if (s.name === "trufflehog") {
		const textChunks: Array<{ field: string; span: SpanRow; text: string }> = [];
		for (const span of spans) {
			if (span.input_summary) textChunks.push({ field: "input_summary", span, text: span.input_summary });
			if (span.attributes) textChunks.push({ field: "attributes", span, text: span.attributes });
		}

		const combined = textChunks.map((c, i) => `--- CHUNK ${i} ---\n${c.text}`).join("\n");
		const results = await s.scan(combined);

		return results.map((r) => {
			// Find which chunk the match came from
			const chunk = textChunks.find((c) => c.text.includes(r.raw_match)) ?? textChunks[0];
			return {
				span_id: chunk?.span.span_id ?? "",
				trace_id: traceId,
				span_name: chunk?.span.name ?? "",
				tool_name: chunk?.span.tool_name ?? null,
				detector: r.detector,
				secret_type: r.secret_type,
				redacted_match: redact(r.raw_match),
				verified: r.verified,
				field: chunk?.field ?? "unknown",
				started_at: chunk?.span.started_at ?? "",
			};
		});
	}

	// Builtin: scan per-span
	const findings: SecretFinding[] = [];
	for (const span of spans) {
		findings.push(...(await scanSpan(span)));
	}
	return findings;
}

export async function scanRecentTraces(limit = 20): Promise<{
	scanner: string;
	traces_scanned: number;
	total_findings: number;
	traces_with_findings: number;
	results: Array<{
		trace_id: string;
		project: string | null;
		finding_count: number;
		findings: SecretFinding[];
	}>;
}> {
	const db = getDb();
	const traces = db
		.query<{ trace_id: string; project: string | null }, [number]>(
			"SELECT trace_id, project FROM traces ORDER BY started_at DESC LIMIT ?",
		)
		.all(limit);

	// Batch scan: collect all span text across all traces, run one trufflehog call
	const traceIds = traces.map((t) => t.trace_id);
	const placeholders = traceIds.map(() => "?").join(",");
	const allSpans = db
		.query<SpanRow & { trace_project?: string }, string[]>(
			`SELECT s.*, t.project as trace_project FROM spans s JOIN traces t ON s.trace_id = t.trace_id WHERE s.trace_id IN (${placeholders})`,
		)
		.all(...traceIds);

	// Build text chunks tagged with trace+span info
	const chunks: Array<{ traceId: string; project: string | null; span: SpanRow; field: string; text: string }> = [];
	for (const span of allSpans) {
		const project = (span as { trace_project?: string }).trace_project ?? null;
		if (span.input_summary) chunks.push({ traceId: span.trace_id, project, span, field: "input_summary", text: span.input_summary });
		if (span.attributes) chunks.push({ traceId: span.trace_id, project, span, field: "attributes", text: span.attributes });
	}

	const s = getScanner();
	const combined = chunks.map((c, i) => `--- ${i} ---\n${c.text}`).join("\n");
	const scanResults = combined.length > 0 ? await s.scan(combined) : [];

	// Map findings back to their source trace/span
	const traceFindings = new Map<string, { project: string | null; findings: SecretFinding[] }>();
	for (const r of scanResults) {
		const chunk = chunks.find((c) => c.text.includes(r.raw_match));
		if (!chunk) continue;
		const entry = traceFindings.get(chunk.traceId) ?? { project: chunk.project, findings: [] };
		entry.findings.push({
			span_id: chunk.span.span_id,
			trace_id: chunk.traceId,
			span_name: chunk.span.name,
			tool_name: chunk.span.tool_name,
			detector: r.detector,
			secret_type: r.secret_type,
			redacted_match: redact(r.raw_match),
			verified: r.verified,
			field: chunk.field,
			started_at: chunk.span.started_at,
		});
		traceFindings.set(chunk.traceId, entry);
	}

	const results = Array.from(traceFindings.entries()).map(([trace_id, { project, findings }]) => ({
		trace_id,
		project,
		finding_count: findings.length,
		findings,
	}));

	const totalFindings = results.reduce((s, r) => s + r.finding_count, 0);
	log.info("Secret scan: {traces} traces, {findings} findings in {affected} traces ({scanner})", {
		traces: traces.length,
		findings: totalFindings,
		affected: results.length,
		scanner: getScanner().name,
	});

	return {
		scanner: getScanner().name,
		traces_scanned: traces.length,
		total_findings: totalFindings,
		traces_with_findings: results.length,
		results,
	};
}
