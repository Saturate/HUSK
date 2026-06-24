import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "./db.js";
import { getKnowledgeSpans, compressTrace } from "./span-compression.js";
import type { SpanRow, TelemetryProvider, TraceRow } from "./telemetry.js";

function buildDateRange(
	period: string | undefined,
	from: string | undefined,
	to: string | undefined,
): { from?: string; to?: string; project?: string } {
	if (from) return { from, to };

	const now = new Date();
	switch (period) {
		case "week":
			return { from: new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10) };
		case "month":
			return { from: new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10) };
		case "all":
			return {};
		default:
			return { from: now.toISOString().slice(0, 10) };
	}
}

export function registerTelemetryTools(server: McpServer, telemetry: TelemetryProvider): void {
	server.registerTool(
		"cost_summary",
		{
			description:
				"Get cost and usage summary for your sessions. Query by time period, project, or model. Returns total cost, sessions, turns, and token usage with breakdowns.",
			inputSchema: {
				period: z
					.enum(["today", "week", "month", "all"])
					.optional()
					.describe("Time period (default: today)"),
				from: z.string().optional().describe("Start date (ISO format, overrides period)"),
				to: z.string().optional().describe("End date (ISO format)"),
				project: z.string().optional().describe("Filter by project"),
				group_by: z
					.enum(["project", "model", "day"])
					.optional()
					.describe("Group results by dimension"),
			},
		},
		async (args) => {
			const opts = buildDateRange(args.period, args.from, args.to);
			if (args.project) opts.project = args.project;

			let data: unknown;
			switch (args.group_by) {
				case "project":
					data = await telemetry.costByProject(opts);
					break;
				case "model":
					data = await telemetry.costByModel(opts);
					break;
				case "day":
					data = await telemetry.costByDay(opts);
					break;
				default:
					data = {
						by_project: await telemetry.costByProject(opts),
						by_model: await telemetry.costByModel(opts),
						by_day: await telemetry.costByDay(opts),
					};
					break;
			}

			return {
				content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
			};
		},
	);

	server.registerTool(
		"tool_stats",
		{
			description:
				"Get tool usage statistics: call counts, failure rates, and durations. Helps identify which tools are most used, slowest, or most error-prone.",
			inputSchema: {
				period: z
					.enum(["today", "week", "month", "all"])
					.optional()
					.describe("Time period (default: today)"),
				from: z.string().optional().describe("Start date (ISO format)"),
				to: z.string().optional().describe("End date (ISO format)"),
				project: z.string().optional().describe("Filter by project"),
			},
		},
		async (args) => {
			const opts = buildDateRange(args.period, args.from, args.to);
			if (args.project) opts.project = args.project;
			const stats = await telemetry.toolUsageStats(opts);
			return {
				content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }],
			};
		},
	);

	server.registerTool(
		"session_timeline",
		{
			description:
				"Get a detailed timeline of a session including all spans (turns, tool calls, subagents). Shows the full span tree with durations and cost breakdown.",
			inputSchema: {
				trace_id: z.string().describe("Trace ID or session ID to inspect"),
			},
		},
		async (args) => {
			const trace = await telemetry.getTrace(args.trace_id);
			if (!trace) {
				return {
					content: [{ type: "text" as const, text: "Trace not found." }],
				};
			}
			const spans = await telemetry.getSpansForTrace(args.trace_id);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ trace, spans }, null, 2),
					},
				],
			};
		},
	);

	server.registerTool(
		"project_insights",
		{
			description:
				"Get observability insights for a project: recent sessions, common tools, failure patterns, cost trends. Useful at session start for context.",
			inputSchema: {
				project: z.string().describe("Project name (git remote)"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(20)
					.optional()
					.describe("Number of recent sessions (default 5)"),
			},
		},
		async (args) => {
			const limit = args.limit ?? 5;
			const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

			const [traces, tools, dailyCost] = await Promise.all([
				telemetry.listTraces({
					project: args.project,
					limit,
				}),
				telemetry.toolUsageStats({
					project: args.project,
					from: thirtyDaysAgo,
				}),
				telemetry.costByDay({
					project: args.project,
					from: thirtyDaysAgo,
				}),
			]);

			const totalCost = dailyCost.reduce((sum, d) => sum + d.total_cost_usd, 0);
			const avgCostPerSession =
				traces.length > 0 ? Math.round((totalCost / traces.length) * 100) / 100 : 0;

			const insights: string[] = [];
			if (totalCost > 0) {
				insights.push(
					`Total cost (30d): $${totalCost.toFixed(2)} across ${traces.length} sessions (avg $${avgCostPerSession}/session)`,
				);
			}

			const failingTools = tools
				.filter((t) => t.failure_rate > 0.1)
				.map((t) => `${t.tool_name} (${Math.round(t.failure_rate * 100)}% failure rate)`);
			if (failingTools.length > 0) {
				insights.push(`Tools with high failure rates: ${failingTools.join(", ")}`);
			}

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								project: args.project,
								recent_sessions: traces,
								top_tools: tools.slice(0, 10),
								cost_trend: dailyCost.slice(-7),
								insights,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.registerTool(
		"get_trace_summary",
		{
			description:
				"Get a compact knowledge summary of a session trace: prompts asked, tools used (grouped), errors, files touched. Use this to decide if you need more detail from specific spans.",
			inputSchema: {
				trace_id: z.string().describe("Trace ID to summarize"),
			},
		},
		async (args) => {
			const trace = await telemetry.getTrace(args.trace_id);
			if (!trace) {
				return { content: [{ type: "text" as const, text: "Trace not found." }] };
			}

			const spans = getKnowledgeSpans(args.trace_id);

			const prompts: string[] = [];
			const toolCounts: Record<string, { count: number; errors: number }> = {};
			const errors: Array<{ tool: string; summary: string }> = [];
			const subagents: Array<{ type: string; name: string }> = [];

			for (const span of spans) {
				if (span.kind === "prompt" && span.input_summary) {
					prompts.push(span.input_summary.slice(0, 200));
				} else if (span.kind === "tool" && span.tool_name) {
					const entry = toolCounts[span.tool_name] ?? { count: 0, errors: 0 };
					entry.count++;
					if (span.status === "error") {
						entry.errors++;
						if (span.input_summary) {
							errors.push({ tool: span.tool_name, summary: span.input_summary.slice(0, 150) });
						}
					}
					toolCounts[span.tool_name] = entry;
				} else if (span.kind === "subagent") {
					const attrs = span.attributes ? JSON.parse(span.attributes) as Record<string, unknown> : {};
					subagents.push({
						type: (attrs.agent_type as string) ?? "unknown",
						name: span.name,
					});
				}
			}

			const summary = {
				trace_id: trace.trace_id,
				project: trace.project,
				model: trace.model,
				status: trace.status,
				started_at: trace.started_at,
				prompts,
				tool_usage: Object.entries(toolCounts)
					.sort(([, a], [, b]) => b.count - a.count)
					.map(([name, stats]) => ({ tool: name, ...stats })),
				errors: errors.slice(0, 10),
				subagents,
				total_knowledge_spans: spans.length,
				has_summary: !!trace.summary,
			};

			return {
				content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	server.registerTool(
		"get_trace_spans",
		{
			description:
				"Get detailed spans from a trace, filtered by kind or tool name. Use after get_trace_summary to drill into specific areas of interest.",
			inputSchema: {
				trace_id: z.string().describe("Trace ID"),
				kind: z
					.enum(["prompt", "tool", "subagent", "skill"])
					.optional()
					.describe("Filter by span kind"),
				tool_name: z
					.string()
					.optional()
					.describe("Filter by tool name (e.g. 'Bash', 'Edit')"),
				status: z
					.enum(["ok", "error"])
					.optional()
					.describe("Filter by status"),
				limit: z.number().int().min(1).max(100).optional().describe("Max spans (default 20)"),
			},
		},
		async (args) => {
			const allSpans = await telemetry.getSpansForTrace(args.trace_id);
			let filtered = allSpans;

			if (args.kind) filtered = filtered.filter((s) => s.kind === args.kind);
			if (args.tool_name) filtered = filtered.filter((s) => s.tool_name === args.tool_name);
			if (args.status) filtered = filtered.filter((s) => s.status === args.status);

			const limit = args.limit ?? 20;
			const result = filtered.slice(0, limit).map((s) => ({
				span_id: s.span_id,
				name: s.name,
				kind: s.kind,
				status: s.status,
				tool_name: s.tool_name,
				input_summary: s.input_summary,
				duration_ms: s.duration_ms,
				started_at: s.started_at,
			}));

			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	server.registerTool(
		"compress_trace",
		{
			description:
				"Compress a session trace into a knowledge summary and store as a searchable memory. Reads knowledge-relevant spans (prompts, tool actions, errors), generates a structured summary, and stores it.",
			inputSchema: {
				trace_id: z.string().describe("Trace ID to compress"),
			},
		},
		async (args) => {
			const trace = await telemetry.getTrace(args.trace_id);
			if (!trace) {
				return { content: [{ type: "text" as const, text: "Trace not found." }] };
			}

			const summary = await compressTrace(trace);
			if (!summary) {
				return { content: [{ type: "text" as const, text: "No knowledge spans to compress." }] };
			}

			return {
				content: [{ type: "text" as const, text: `Summary stored:\n\n${summary}` }],
			};
		},
	);
}
