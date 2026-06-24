import { api } from "@/api";
import { AppLayout } from "@/components/layout";
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
import { useNavigate } from "react-router";

export function ProjectsPage() {
	const navigate = useNavigate();

	const { data, isLoading } = useQuery({
		queryKey: ["telemetry", "projects"],
		queryFn: () => api.getTelemetryProjects(),
	});

	return (
		<AppLayout>
			<h2 className="mb-6 text-2xl font-semibold">Projects</h2>

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
							<TableRow
								key={p.project}
								className="cursor-pointer hover:bg-muted/50"
								onClick={() =>
									navigate(`/tracing?project=${encodeURIComponent(p.project)}`)
								}
							>
								<TableCell className="text-sm font-medium">{p.project}</TableCell>
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
		</AppLayout>
	);
}
