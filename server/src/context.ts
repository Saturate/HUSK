import { getLogger } from "@logtape/logtape";
import { getTelemetryProviderOrNull } from "./telemetry.js";

const log = getLogger(["husk", "context"]);

export interface ContextInsight {
	type: "cost_alert" | "failure_pattern" | "branch_context" | "tool_suggestion";
	severity: "info" | "warning";
	message: string;
}

export async function synthesizeInsights(params: {
	userId: string;
	project: string | null;
	gitBranch?: string | null;
}): Promise<ContextInsight[]> {
	const telemetry = getTelemetryProviderOrNull();
	if (!telemetry || !params.project) return [];

	const insights: ContextInsight[] = [];
	const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
	const today = new Date().toISOString().slice(0, 10);

	try {
		const [dailyCosts, toolStats, recentTraces] = await Promise.all([
			telemetry.costByDay({ project: params.project, from: sevenDaysAgo }),
			telemetry.toolUsageStats({ project: params.project, from: sevenDaysAgo }),
			telemetry.listTraces({ project: params.project, limit: 20 }),
		]);

		// Cost alert: today's cost > 3x the 7-day daily average
		if (dailyCosts.length > 1) {
			const todayEntry = dailyCosts.find((d) => d.date === today);
			const pastDays = dailyCosts.filter((d) => d.date !== today);
			if (todayEntry && pastDays.length > 0) {
				const avgCost =
					pastDays.reduce((sum, d) => sum + d.total_cost_usd, 0) / pastDays.length;
				if (avgCost > 0 && todayEntry.total_cost_usd > avgCost * 3) {
					insights.push({
						type: "cost_alert",
						severity: "warning",
						message: `Today's cost ($${todayEntry.total_cost_usd.toFixed(2)}) is ${Math.round(todayEntry.total_cost_usd / avgCost)}x your daily average ($${avgCost.toFixed(2)}) for this project.`,
					});
				}
			}
		}

		// Failure pattern: any tool with >15% failure rate
		for (const tool of toolStats) {
			if (tool.failure_rate > 0.15 && tool.call_count >= 5) {
				insights.push({
					type: "failure_pattern",
					severity: "warning",
					message: `${tool.tool_name} has a ${Math.round(tool.failure_rate * 100)}% failure rate (${tool.failure_count}/${tool.call_count} calls) in the last 7 days.`,
				});
			}
		}

		// Branch context: previous sessions on the same branch
		if (params.gitBranch) {
			const branchTraces = recentTraces.filter(
				(t) => t.git_branch === params.gitBranch,
			);
			if (branchTraces.length > 0) {
				const totalCost = branchTraces.reduce(
					(sum, t) => sum + t.total_cost_usd,
					0,
				);
				insights.push({
					type: "branch_context",
					severity: "info",
					message: `${branchTraces.length} previous session(s) on branch "${params.gitBranch}", total cost: $${totalCost.toFixed(2)}.`,
				});
			}
		}

		// Tool suggestion: tool with >40% of calls and 0% failure rate
		const totalCalls = toolStats.reduce((sum, t) => sum + t.call_count, 0);
		if (totalCalls > 10) {
			for (const tool of toolStats) {
				if (
					tool.call_count / totalCalls > 0.4 &&
					tool.failure_rate === 0 &&
					tool.call_count >= 10
				) {
					insights.push({
						type: "tool_suggestion",
						severity: "info",
						message: `${tool.tool_name} accounts for ${Math.round((tool.call_count / totalCalls) * 100)}% of tool calls with 0% failures. Consider auto-approving it.`,
					});
				}
			}
		}
	} catch (err) {
		log.warn("Failed to synthesize context insights: {error}", {
			error: err instanceof Error ? err.message : String(err),
		});
	}

	return insights.slice(0, 5);
}

export function formatInsights(insights: ContextInsight[]): string {
	if (insights.length === 0) return "";
	const lines = insights.map(
		(i) => `- ${i.severity === "warning" ? "[!] " : ""}${i.message}`,
	);
	return `\n\nSession insights:\n${lines.join("\n")}`;
}
