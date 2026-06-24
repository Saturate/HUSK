import type { SpanRow } from "@/api";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface TreeNode {
	span: SpanRow;
	children: TreeNode[];
}

function buildTree(spans: SpanRow[]): TreeNode[] {
	const map = new Map<string, TreeNode>();
	const roots: TreeNode[] = [];

	for (const span of spans) {
		map.set(span.span_id, { span, children: [] });
	}

	for (const span of spans) {
		const node = map.get(span.span_id);
		if (!node) continue;

		if (span.parent_span_id) {
			const parent = map.get(span.parent_span_id);
			if (parent) {
				parent.children.push(node);
				continue;
			}
		}
		roots.push(node);
	}

	return roots;
}

const KIND_COLORS: Record<string, string> = {
	turn: "default",
	tool: "secondary",
	subagent: "outline",
	compaction: "secondary",
	permission: "destructive",
	prompt: "outline",
};

interface SpanNodeProps {
	node: TreeNode;
	depth: number;
	selectedSpanId?: string | null;
	onSelectSpan?: (spanId: string) => void;
}

function SpanNode({ node, depth, selectedSpanId, onSelectSpan }: SpanNodeProps) {
	const [expanded, setExpanded] = useState(depth < 2);
	const hasChildren = node.children.length > 0;
	const s = node.span;
	const isSelected = selectedSpanId === s.span_id;

	return (
		<div>
			<div
				className={`flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50 ${isSelected ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""} ${onSelectSpan ? "cursor-pointer" : ""}`}
				style={{ paddingLeft: `${depth * 20 + 8}px` }}
				onClick={onSelectSpan ? () => onSelectSpan(s.span_id) : undefined}
			>
				{hasChildren ? (
					<button
						type="button"
						onClick={() => setExpanded(!expanded)}
						className="shrink-0 text-muted-foreground"
						aria-label={expanded ? "Collapse" : "Expand"}
					>
						{expanded ? (
							<ChevronDown className="h-3.5 w-3.5" />
						) : (
							<ChevronRight className="h-3.5 w-3.5" />
						)}
					</button>
				) : (
					<span className="inline-block w-3.5" />
				)}

				<Badge
					variant={(KIND_COLORS[s.kind] as "default" | "secondary" | "outline" | "destructive") ?? "outline"}
					className="shrink-0 text-[10px]"
				>
					{s.kind}
				</Badge>

				<span className="truncate font-mono text-xs">{s.name}</span>

				{s.tool_name && (
					<span className="shrink-0 text-xs text-muted-foreground">{s.tool_name}</span>
				)}

				<span className="ml-auto flex shrink-0 gap-3 text-xs text-muted-foreground">
					{s.duration_ms != null && <span>{s.duration_ms}ms</span>}
					{s.cost_usd != null && s.cost_usd > 0 && (
						<span>${s.cost_usd.toFixed(4)}</span>
					)}
					{s.status === "error" && (
						<Badge variant="destructive" className="text-[10px]">
							error
						</Badge>
					)}
				</span>
			</div>

			{expanded &&
				node.children.map((child) => (
					<SpanNode key={child.span.id} node={child} depth={depth + 1} selectedSpanId={selectedSpanId} onSelectSpan={onSelectSpan} />
				))}
		</div>
	);
}

interface SpanTreeProps {
	spans: SpanRow[];
	selectedSpanId?: string | null;
	onSelectSpan?: (spanId: string) => void;
}

export function SpanTree({ spans, selectedSpanId, onSelectSpan }: SpanTreeProps) {
	const tree = buildTree(spans);

	if (tree.length === 0) {
		return <p className="text-sm text-muted-foreground">No spans recorded.</p>;
	}

	return (
		<div className="rounded-lg border">
			{tree.map((node) => (
				<SpanNode key={node.span.id} node={node} depth={0} selectedSpanId={selectedSpanId} onSelectSpan={onSelectSpan} />
			))}
		</div>
	);
}
