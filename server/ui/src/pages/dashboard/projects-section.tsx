import { api } from "@/api";
import { formatCost } from "@/lib/format";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

export function ProjectsSection() {
	const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

	const { data, isLoading } = useQuery({
		queryKey: ["telemetry", "projects", thirtyDaysAgo],
		queryFn: () => api.getTelemetryProjects(thirtyDaysAgo),
	});

	return (
		<div className="mb-8">
			<h3 className="mb-3 text-lg font-medium">Projects</h3>
			{isLoading ? (
				<p className="text-sm text-muted-foreground">Loading...</p>
			) : (data?.length ?? 0) === 0 ? (
				<p className="text-sm text-muted-foreground">No project data yet.</p>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Project</TableHead>
							<TableHead className="text-right">Cost</TableHead>
							<TableHead className="text-right">Sessions</TableHead>
							<TableHead className="text-right">Turns</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data?.map((p) => (
							<TableRow key={p.project}>
								<TableCell>
									<Link
										to={`/tracing?project=${encodeURIComponent(p.project)}`}
										className="text-sm font-medium hover:underline"
									>
										{p.project}
									</Link>
								</TableCell>
								<TableCell className="text-right text-sm">
									{formatCost(p.total_cost_usd)}
								</TableCell>
								<TableCell className="text-right text-sm text-muted-foreground">
									{p.session_count}
								</TableCell>
								<TableCell className="text-right text-sm text-muted-foreground">
									{p.total_turns}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</div>
	);
}
