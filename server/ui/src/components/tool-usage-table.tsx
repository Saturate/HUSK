import type { ToolStat } from "@/api";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useState } from "react";

interface McpGroup {
	server: string;
	tools: ToolStat[];
	totalCalls: number;
	totalFailures: number;
	failureRate: number;
	avgDuration: number;
}

function groupTools(tools: ToolStat[]): { native: ToolStat[]; mcp: McpGroup[] } {
	const native: ToolStat[] = [];
	const mcpMap = new Map<string, ToolStat[]>();

	for (const t of tools) {
		if (t.tool_name.startsWith("mcp__")) {
			const parts = t.tool_name.slice(5).split("__");
			const server = parts[0] ?? "unknown";
			const group = mcpMap.get(server) ?? [];
			group.push(t);
			mcpMap.set(server, group);
		} else {
			native.push(t);
		}
	}

	const mcp: McpGroup[] = [];
	for (const [server, grpTools] of mcpMap) {
		const totalCalls = grpTools.reduce((s, t) => s + t.call_count, 0);
		const totalFailures = grpTools.reduce((s, t) => s + t.failure_count, 0);
		const totalDuration = grpTools.reduce((s, t) => s + t.avg_duration_ms * t.call_count, 0);
		mcp.push({
			server,
			tools: grpTools.sort((a, b) => b.call_count - a.call_count),
			totalCalls,
			totalFailures,
			failureRate: totalCalls > 0 ? totalFailures / totalCalls : 0,
			avgDuration: totalCalls > 0 ? totalDuration / totalCalls : 0,
		});
	}

	mcp.sort((a, b) => b.totalCalls - a.totalCalls);
	return { native, mcp };
}

export function ToolUsageTable({ tools }: { tools: ToolStat[] }) {
	const { native, mcp } = groupTools(tools);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const toggle = (server: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(server)) next.delete(server);
			else next.add(server);
			return next;
		});
	};

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Tool</TableHead>
					<TableHead className="text-right">Calls</TableHead>
					<TableHead className="text-right">Failures</TableHead>
					<TableHead className="text-right">Failure rate</TableHead>
					<TableHead className="text-right">Avg duration</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{native.map((t) => (
					<ToolRow key={t.tool_name} name={t.tool_name} stat={t} />
				))}
				{mcp.map((g) => (
					<McpGroupRows
						key={g.server}
						group={g}
						isExpanded={expanded.has(g.server)}
						onToggle={() => toggle(g.server)}
					/>
				))}
			</TableBody>
		</Table>
	);
}

function ToolRow({ name, stat, indent }: { name: string; stat: ToolStat; indent?: boolean }) {
	return (
		<TableRow>
			<TableCell className={`text-sm font-medium ${indent ? "pl-8" : ""}`}>
				{indent ? <span className="mr-1 text-muted-foreground">{"└"}</span> : null}
				{name}
			</TableCell>
			<TableCell className="text-right text-sm">{stat.call_count}</TableCell>
			<TableCell className="text-right text-sm">{stat.failure_count}</TableCell>
			<TableCell className="text-right text-sm">
				<FailureRateBadge rate={stat.failure_rate} />
			</TableCell>
			<TableCell className="text-right text-sm text-muted-foreground">
				{stat.avg_duration_ms > 0 ? `${Math.round(stat.avg_duration_ms)}ms` : "—"}
			</TableCell>
		</TableRow>
	);
}

function McpGroupRows({
	group,
	isExpanded,
	onToggle,
}: { group: McpGroup; isExpanded: boolean; onToggle: () => void }) {
	return (
		<>
			<TableRow className="cursor-pointer hover:bg-muted/50" onClick={onToggle}>
				<TableCell className="text-sm font-medium">
					<span className="mr-1 text-muted-foreground">{isExpanded ? "▾" : "▸"}</span>
					mcp: {group.server}
					<span className="ml-2 text-xs text-muted-foreground">
						({group.tools.length} tools)
					</span>
				</TableCell>
				<TableCell className="text-right text-sm">{group.totalCalls}</TableCell>
				<TableCell className="text-right text-sm">{group.totalFailures}</TableCell>
				<TableCell className="text-right text-sm">
					<FailureRateBadge rate={group.failureRate} />
				</TableCell>
				<TableCell className="text-right text-sm text-muted-foreground">
					{group.avgDuration > 0 ? `${Math.round(group.avgDuration)}ms` : "—"}
				</TableCell>
			</TableRow>
			{isExpanded &&
				group.tools.map((t) => {
					const shortName = t.tool_name.replace(`mcp__${group.server}__`, "");
					return <ToolRow key={t.tool_name} name={shortName} stat={t} indent />;
				})}
		</>
	);
}

function FailureRateBadge({ rate }: { rate: number }) {
	if (rate > 0.1) {
		return (
			<Badge variant="destructive" className="text-xs">
				{(rate * 100).toFixed(1)}%
			</Badge>
		);
	}
	return <span className="text-muted-foreground">{(rate * 100).toFixed(1)}%</span>;
}
