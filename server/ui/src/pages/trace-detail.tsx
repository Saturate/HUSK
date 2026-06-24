import { api, type SpanRow } from "@/api";
import { AppLayout } from "@/components/layout";
import { SpanDetailPanel } from "@/components/span-detail-panel";
import { SpanTree } from "@/components/span-tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCost, formatTokens } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

export function TraceDetailPage() {
	const { traceId } = useParams<{ traceId: string }>();
	const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

	const query = useQuery({
		queryKey: ["trace-detail", traceId],
		queryFn: () => {
			if (!traceId) throw new Error("Missing traceId");
			return api.getTraceDetail(traceId);
		},
		enabled: !!traceId,
	});

	if (query.isLoading) {
		return (
			<AppLayout>
				<p className="text-sm text-muted-foreground">Loading trace...</p>
			</AppLayout>
		);
	}

	if (query.error || !query.data) {
		return (
			<AppLayout>
				<p className="text-sm text-destructive">
					{query.error instanceof Error ? query.error.message : "Trace not found."}
				</p>
			</AppLayout>
		);
	}

	const { trace, spans } = query.data;
	const selectedSpan = selectedSpanId
		? spans.find((s: SpanRow) => s.span_id === selectedSpanId) ?? null
		: null;

	return (
		<AppLayout>
			{/* Top bar */}
			<div className="mb-4 flex flex-wrap items-center gap-3">
				<Button variant="ghost" size="sm" asChild>
					<Link to="/tracing">
						<ChevronLeft className="mr-1 h-4 w-4" />
						Traces
					</Link>
				</Button>

				<div className="flex flex-wrap items-center gap-2">
					{trace.project && (
						<Badge variant="outline">{trace.project}</Badge>
					)}
					{trace.model && (
						<span className="text-sm text-muted-foreground font-mono">
							{trace.model}
						</span>
					)}
					<Badge variant={trace.status === "active" ? "default" : "secondary"}>
						{trace.status}
					</Badge>
					<span className="text-sm font-medium">{formatCost(trace.total_cost_usd)}</span>
					<span className="text-sm text-muted-foreground">
						{formatTokens(trace.total_input_tokens)} in / {formatTokens(trace.total_output_tokens)} out
					</span>
					<span className="text-sm text-muted-foreground">
						{trace.total_turns} turns
					</span>
					<span className="text-sm text-muted-foreground">
						{new Date(trace.started_at).toLocaleString()}
					</span>
				</div>
			</div>

			{/* Two-panel layout */}
			<div className="flex gap-0 rounded-lg border" style={{ height: "calc(100vh - 12rem)" }}>
				{/* Left: span tree */}
				<div className="w-2/5 shrink-0 overflow-y-auto border-r p-3">
					<SpanTree
						spans={spans}
						selectedSpanId={selectedSpanId}
						onSelectSpan={setSelectedSpanId}
					/>
				</div>

				{/* Right: span detail */}
				<div className="flex-1 overflow-y-auto p-4">
					{selectedSpan ? (
						<SpanDetailPanel span={selectedSpan} />
					) : (
						<div className="flex h-full items-center justify-center">
							<p className="text-sm text-muted-foreground">
								Select a span to view details
							</p>
						</div>
					)}
				</div>
			</div>
		</AppLayout>
	);
}
