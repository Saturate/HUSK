import { beforeEach, describe, expect, test } from "bun:test";
import { createApiKey, createUser } from "./db.js";
import { SqliteTelemetryProvider } from "./telemetry-sqlite.js";
import { setTelemetryProvider } from "./telemetry.js";
import { createTestApp } from "./test-helpers.js";

let telemetry: SqliteTelemetryProvider;
let apiKeyId: string;

function setup() {
	createTestApp();
	telemetry = new SqliteTelemetryProvider();
	setTelemetryProvider(telemetry);

	const userId = createUser("teluser", "hash", { role: "admin" });
	apiKeyId = createApiKey({
		userId,
		label: "test",
		keyHash: `hash-${crypto.randomUUID()}`,
		keyPrefix: "husk_test",
		expiresAt: null,
	});
}

describe("SqliteTelemetryProvider", () => {
	beforeEach(setup);

	describe("traces", () => {
		test("startTrace creates a trace", async () => {
			const trace = await telemetry.startTrace({
				traceId: "trace-001",
				apiKeyId,
				project: "test-project",
				model: "opus",
			});
			expect(trace.trace_id).toBe("trace-001");
			expect(trace.project).toBe("test-project");
			expect(trace.status).toBe("active");
		});

		test("endTrace updates totals and status", async () => {
			await telemetry.startTrace({ traceId: "trace-002", apiKeyId });
			await telemetry.endTrace("trace-002", {
				totalInputTokens: 1000,
				totalOutputTokens: 500,
				totalCostUsd: 0.05,
				totalTurns: 3,
			});

			const trace = await telemetry.getTrace("trace-002");
			expect(trace?.status).toBe("ended");
			expect(trace?.total_input_tokens).toBe(1000);
			expect(trace?.total_output_tokens).toBe(500);
			expect(trace?.total_cost_usd).toBe(0.05);
			expect(trace?.total_turns).toBe(3);
		});

		test("getTrace returns null for missing trace", async () => {
			expect(await telemetry.getTrace("nonexistent")).toBeNull();
		});

		test("listTraces filters by project", async () => {
			await telemetry.startTrace({ traceId: "t1", apiKeyId, project: "alpha" });
			await telemetry.startTrace({ traceId: "t2", apiKeyId, project: "beta" });
			await telemetry.startTrace({ traceId: "t3", apiKeyId, project: "alpha" });

			const results = await telemetry.listTraces({ project: "alpha" });
			expect(results.length).toBe(2);
			expect(results.every((r) => r.project === "alpha")).toBe(true);
		});

		test("listTraces filters by status", async () => {
			await telemetry.startTrace({ traceId: "s1", apiKeyId });
			await telemetry.startTrace({ traceId: "s2", apiKeyId });
			await telemetry.endTrace("s1", {});

			const ended = await telemetry.listTraces({ status: "ended" });
			expect(ended.length).toBe(1);
			expect(ended[0]?.trace_id).toBe("s1");
		});
	});

	describe("spans", () => {
		test("createSpan creates a span", async () => {
			await telemetry.startTrace({ traceId: "sp-trace", apiKeyId });
			const span = await telemetry.createSpan({
				traceId: "sp-trace",
				spanId: "span-001",
				name: "tool/Bash",
				kind: "tool",
				startedAt: new Date().toISOString(),
				toolName: "Bash",
				inputSummary: "ls -la",
				durationMs: 150,
			});

			expect(span.span_id).toBe("span-001");
			expect(span.tool_name).toBe("Bash");
			expect(span.duration_ms).toBe(150);
		});

		test("getSpansForTrace returns spans ordered by time", async () => {
			await telemetry.startTrace({ traceId: "sp-t2", apiKeyId });
			await telemetry.createSpan({
				traceId: "sp-t2",
				spanId: "a",
				name: "turn/1",
				kind: "turn",
				startedAt: "2026-01-01T00:00:01Z",
			});
			await telemetry.createSpan({
				traceId: "sp-t2",
				spanId: "b",
				name: "tool/Edit",
				kind: "tool",
				startedAt: "2026-01-01T00:00:02Z",
				toolName: "Edit",
			});

			const spans = await telemetry.getSpansForTrace("sp-t2");
			expect(spans.length).toBe(2);
			expect(spans[0]?.span_id).toBe("a");
			expect(spans[1]?.span_id).toBe("b");
		});

		test("getSpansForTrace filters by kind", async () => {
			await telemetry.startTrace({ traceId: "sp-t3", apiKeyId });
			await telemetry.createSpan({ traceId: "sp-t3", spanId: "x", name: "turn/1", kind: "turn", startedAt: "2026-01-01T00:00:00Z" });
			await telemetry.createSpan({ traceId: "sp-t3", spanId: "y", name: "tool/Bash", kind: "tool", startedAt: "2026-01-01T00:00:01Z" });

			const tools = await telemetry.getSpansForTrace("sp-t3", "tool");
			expect(tools.length).toBe(1);
			expect(tools[0]?.kind).toBe("tool");
		});

		test("updateSpan modifies fields", async () => {
			await telemetry.startTrace({ traceId: "sp-t4", apiKeyId });
			await telemetry.createSpan({ traceId: "sp-t4", spanId: "upd", name: "tool/Bash", kind: "tool", startedAt: "2026-01-01T00:00:00Z" });

			await telemetry.updateSpan("upd", { status: "error", durationMs: 500, exitCode: 1 });

			const spans = await telemetry.getSpansForTrace("sp-t4");
			expect(spans[0]?.status).toBe("error");
			expect(spans[0]?.duration_ms).toBe(500);
			expect(spans[0]?.exit_code).toBe(1);
		});
	});

	describe("aggregations", () => {
		async function seedData() {
			await telemetry.startTrace({ traceId: "agg1", apiKeyId, project: "proj-a", model: "opus" });
			await telemetry.endTrace("agg1", { totalCostUsd: 10.0, totalTurns: 5 });

			await telemetry.startTrace({ traceId: "agg2", apiKeyId, project: "proj-a", model: "sonnet" });
			await telemetry.endTrace("agg2", { totalCostUsd: 3.0, totalTurns: 2 });

			await telemetry.startTrace({ traceId: "agg3", apiKeyId, project: "proj-b", model: "opus" });
			await telemetry.endTrace("agg3", { totalCostUsd: 7.0, totalTurns: 4 });

			// Add tool spans for tool stats
			await telemetry.createSpan({ traceId: "agg1", spanId: "tool1", name: "tool/Bash", kind: "tool", startedAt: "2026-01-01T00:00:00Z", toolName: "Bash", durationMs: 100 });
			await telemetry.createSpan({ traceId: "agg1", spanId: "tool2", name: "tool/Bash", kind: "tool", startedAt: "2026-01-01T00:00:01Z", toolName: "Bash", durationMs: 200 });
			await telemetry.createSpan({ traceId: "agg1", spanId: "tool3", name: "tool/Edit", kind: "tool", startedAt: "2026-01-01T00:00:02Z", toolName: "Edit", durationMs: 50 });
			// One error
			await telemetry.createSpan({ traceId: "agg1", spanId: "tool4", name: "tool/Bash", kind: "tool", startedAt: "2026-01-01T00:00:03Z", toolName: "Bash", durationMs: 300 });
			await telemetry.updateSpan("tool4", { status: "error" });
		}

		test("costByProject groups correctly", async () => {
			await seedData();
			const results = await telemetry.costByProject({});
			expect(results.length).toBe(2);

			const projA = results.find((r) => r.project === "proj-a");
			expect(projA?.total_cost_usd).toBe(13.0);
			expect(projA?.session_count).toBe(2);
			expect(projA?.total_turns).toBe(7);

			const projB = results.find((r) => r.project === "proj-b");
			expect(projB?.total_cost_usd).toBe(7.0);
		});

		test("costByModel groups correctly", async () => {
			await seedData();
			const results = await telemetry.costByModel({});

			const opus = results.find((r) => r.model === "opus");
			expect(opus?.total_cost_usd).toBe(17.0);
			expect(opus?.session_count).toBe(2);
		});

		test("costByDay groups by date", async () => {
			await seedData();
			const results = await telemetry.costByDay({});
			expect(results.length).toBeGreaterThan(0);
			const total = results.reduce((s, r) => s + r.total_cost_usd, 0);
			expect(total).toBe(20.0);
		});

		test("toolUsageStats counts tools", async () => {
			await seedData();
			const results = await telemetry.toolUsageStats({});

			const bash = results.find((r) => r.tool_name === "Bash");
			expect(bash?.call_count).toBe(3);
			expect(bash?.failure_count).toBe(1);

			const edit = results.find((r) => r.tool_name === "Edit");
			expect(edit?.call_count).toBe(1);
			expect(edit?.failure_count).toBe(0);
		});
	});
});
