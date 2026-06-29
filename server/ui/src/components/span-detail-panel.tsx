import type { SpanRow } from "@/api";
import { Badge } from "@/components/ui/badge";
import { formatCost, formatDuration, formatTokens } from "@/lib/format";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

const KIND_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
	turn: "default",
	tool: "secondary",
	subagent: "outline",
	compaction: "secondary",
	permission: "destructive",
	prompt: "outline",
};

function MetadataRow({ label, value }: { label: string; value: string | null | undefined }) {
	if (value == null) return null;
	return (
		<div className="flex justify-between py-1.5 text-sm border-b border-border/50 last:border-0">
			<span className="text-muted-foreground">{label}</span>
			<span className="font-mono text-right">{value}</span>
		</div>
	);
}

export function SpanDetailPanel({ span }: { span: SpanRow }) {
	const [showAttrs, setShowAttrs] = useState(false);

	const hasTokens =
		span.input_tokens != null ||
		span.output_tokens != null ||
		span.cache_read_tokens != null ||
		span.cache_create_tokens != null;

	let parsedAttrs: Record<string, unknown> | null = null;
	if (span.attributes) {
		try {
			parsedAttrs = JSON.parse(span.attributes) as Record<string, unknown>;
		} catch {
			// malformed JSON
		}
	}

	return (
		<div className="space-y-5">
			{/* Header */}
			<div>
				<h3 className="text-lg font-semibold font-mono mb-2">{span.name}</h3>
				<div className="flex items-center gap-2">
					<Badge variant={KIND_VARIANT[span.kind] ?? "outline"} className="text-xs">
						{span.kind}
					</Badge>
					{span.status === "error" ? (
						<Badge variant="destructive" className="text-xs">
							error
						</Badge>
					) : (
						<Badge variant="outline" className="text-xs">
							ok
						</Badge>
					)}
					{span.tool_name && (
						<span className="text-sm text-muted-foreground">{span.tool_name}</span>
					)}
				</div>
			</div>

			{/* Metadata grid */}
			<div className="rounded-lg border p-3">
				<MetadataRow label="Duration" value={formatDuration(span.duration_ms)} />
				<MetadataRow
					label="Cost"
					value={span.cost_usd != null ? formatCost(span.cost_usd) : null}
				/>
				<MetadataRow label="Tool" value={span.tool_name} />
				<MetadataRow label="Model" value={span.model} />
				<MetadataRow
					label="Exit code"
					value={span.exit_code != null ? String(span.exit_code) : null}
				/>
				<MetadataRow
					label="Output size"
					value={span.output_size != null ? `${span.output_size} bytes` : null}
				/>
				<MetadataRow label="Started" value={span.started_at} />
				<MetadataRow label="Ended" value={span.ended_at} />
				<MetadataRow label="Span ID" value={span.span_id} />
				{span.parent_span_id && <MetadataRow label="Parent span" value={span.parent_span_id} />}
			</div>

			{/* Token usage */}
			{hasTokens && (
				<div>
					<h4 className="text-sm font-medium mb-2">Token usage</h4>
					<div className="grid grid-cols-2 gap-2">
						{span.input_tokens != null && (
							<div className="rounded border p-2 text-center">
								<div className="text-lg font-mono">{formatTokens(span.input_tokens)}</div>
								<div className="text-xs text-muted-foreground">Input</div>
							</div>
						)}
						{span.output_tokens != null && (
							<div className="rounded border p-2 text-center">
								<div className="text-lg font-mono">{formatTokens(span.output_tokens)}</div>
								<div className="text-xs text-muted-foreground">Output</div>
							</div>
						)}
						{span.cache_read_tokens != null && (
							<div className="rounded border p-2 text-center">
								<div className="text-lg font-mono">{formatTokens(span.cache_read_tokens)}</div>
								<div className="text-xs text-muted-foreground">Cache read</div>
							</div>
						)}
						{span.cache_create_tokens != null && (
							<div className="rounded border p-2 text-center">
								<div className="text-lg font-mono">{formatTokens(span.cache_create_tokens)}</div>
								<div className="text-xs text-muted-foreground">Cache create</div>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Input summary */}
			{span.input_summary && (
				<div>
					<h4 className="text-sm font-medium mb-2">Input</h4>
					<pre className="rounded-lg bg-muted p-3 font-mono text-sm whitespace-pre-wrap break-all overflow-x-auto max-h-64 overflow-y-auto">
						{span.input_summary}
					</pre>
				</div>
			)}

			{/* Attributes */}
			{parsedAttrs && Object.keys(parsedAttrs).length > 0 && (
				<div>
					<button
						type="button"
						className="flex items-center gap-1 text-sm font-medium hover:text-foreground text-muted-foreground"
						onClick={() => setShowAttrs(!showAttrs)}
					>
						{showAttrs ? (
							<ChevronDown className="h-3.5 w-3.5" />
						) : (
							<ChevronRight className="h-3.5 w-3.5" />
						)}
						Attributes
					</button>
					{showAttrs && (
						<pre className="mt-2 rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all overflow-x-auto max-h-64 overflow-y-auto">
							{JSON.stringify(parsedAttrs, null, 2)}
						</pre>
					)}
				</div>
			)}
		</div>
	);
}
