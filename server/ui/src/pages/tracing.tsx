import { api } from "@/api";
import { AppLayout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatCost, formatTokens } from "@/lib/format";
import { relativeTime } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

const PAGE_SIZE = 25;
const ALL = "__all__";

export function TracingPage() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const initialProject = searchParams.get("project") ?? ALL;

	const [page, setPage] = useState(0);
	const [projectFilter, setProjectFilter] = useState(initialProject);
	const [statusFilter, setStatusFilter] = useState(ALL);

	const tracesQuery = useQuery({
		queryKey: ["traces", projectFilter, statusFilter, page],
		queryFn: () =>
			api.getTraces({
				project: projectFilter !== ALL ? projectFilter : undefined,
				status: statusFilter !== ALL ? statusFilter : undefined,
				limit: PAGE_SIZE,
				offset: page * PAGE_SIZE,
			}),
	});

	const projectsQuery = useQuery({
		queryKey: ["telemetry", "projects-list"],
		queryFn: () => api.getTelemetryProjects(),
	});

	const traces = tracesQuery.data ?? [];
	const projects = projectsQuery.data?.map((p) => p.project) ?? [];
	const hasMore = traces.length === PAGE_SIZE;

	function handleProjectChange(value: string) {
		setProjectFilter(value);
		setPage(0);
	}

	function handleStatusChange(value: string) {
		setStatusFilter(value);
		setPage(0);
	}

	return (
		<AppLayout>
			<h2 className="mb-6 text-2xl font-semibold">Tracing</h2>

			{/* Filters */}
			<div className="mb-4 flex flex-wrap items-end gap-3">
				<div className="space-y-1">
					<span className="text-xs text-muted-foreground">Project</span>
					<Select value={projectFilter} onValueChange={handleProjectChange}>
						<SelectTrigger className="w-48">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>All projects</SelectItem>
							{projects.map((p) => (
								<SelectItem key={p} value={p}>
									{p}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-1">
					<span className="text-xs text-muted-foreground">Status</span>
					<Select value={statusFilter} onValueChange={handleStatusChange}>
						<SelectTrigger className="w-32">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>All</SelectItem>
							<SelectItem value="active">Active</SelectItem>
							<SelectItem value="ended">Ended</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			{/* Table */}
			{tracesQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">Loading traces...</p>
			) : traces.length === 0 ? (
				<p className="text-sm text-muted-foreground">No traces found.</p>
			) : (
				<>
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Project</TableHead>
									<TableHead>Model</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Cost</TableHead>
									<TableHead className="text-right">Turns</TableHead>
									<TableHead className="text-right">Tools</TableHead>
									<TableHead className="text-right">Tokens</TableHead>
									<TableHead className="text-right">Started</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{traces.map((t) => (
									<TableRow
										key={t.id}
										className="cursor-pointer"
										onClick={() => navigate(`/tracing/${t.trace_id}`)}
									>
										<TableCell className="text-sm font-medium">
											{t.project ?? "(unknown)"}
										</TableCell>
										<TableCell className="text-sm text-muted-foreground font-mono">
											{t.model ? t.model.replace("claude-", "").replace("[1m]", "") : "-"}
										</TableCell>
										<TableCell>
											<Badge variant={t.status === "active" ? "default" : "secondary"} className="text-xs">
												{t.status}
											</Badge>
										</TableCell>
										<TableCell className="text-right text-sm">
											{formatCost(t.total_cost_usd)}
										</TableCell>
										<TableCell className="text-right text-sm text-muted-foreground">
											{t.total_turns}
										</TableCell>
										<TableCell className="text-right text-sm text-muted-foreground">
											{t.total_tool_calls}
										</TableCell>
										<TableCell className="text-right text-sm text-muted-foreground">
											{formatTokens(t.total_input_tokens)} / {formatTokens(t.total_output_tokens)}
										</TableCell>
										<TableCell className="text-right text-sm text-muted-foreground">
											{relativeTime(t.started_at)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>

					{/* Pagination */}
					<div className="mt-4 flex items-center justify-between">
						<span className="text-sm text-muted-foreground">
							Page {page + 1}
						</span>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={page === 0}
								onClick={() => setPage(page - 1)}
							>
								<ChevronLeft className="mr-1 h-4 w-4" /> Prev
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={!hasMore}
								onClick={() => setPage(page + 1)}
							>
								Next <ChevronRight className="ml-1 h-4 w-4" />
							</Button>
						</div>
					</div>
				</>
			)}
		</AppLayout>
	);
}
