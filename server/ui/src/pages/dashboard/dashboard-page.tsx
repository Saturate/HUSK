import { api } from "@/api";
import { AppLayout } from "@/components/layout";
import { ToolUsageTable } from "@/components/tool-usage-table";
import { useQuery } from "@tanstack/react-query";
import { CostOverviewCards } from "./cost-overview-cards";
import { DailyCostSection } from "./daily-cost-section";
import { ModelsSection } from "./models-section";
import { ProjectsSection } from "./projects-section";
import { RecentMemoriesCard } from "./recent-memories-card";

export function DashboardPage() {
	const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

	const toolsQuery = useQuery({
		queryKey: ["telemetry", "tools", thirtyDaysAgo],
		queryFn: () => api.getTelemetryTools(thirtyDaysAgo),
	});

	return (
		<AppLayout>
			<h2 className="mb-6 text-2xl font-semibold">Dashboard</h2>

			<CostOverviewCards />
			<DailyCostSection />
			<ProjectsSection />

			<div className="mb-8">
				<h3 className="mb-3 text-lg font-medium">Tool usage</h3>
				{toolsQuery.isLoading ? (
					<p className="text-sm text-muted-foreground">Loading...</p>
				) : (toolsQuery.data?.length ?? 0) === 0 ? (
					<p className="text-sm text-muted-foreground">No tool data yet.</p>
				) : (
					<ToolUsageTable tools={toolsQuery.data ?? []} />
				)}
			</div>

			<ModelsSection />
			<RecentMemoriesCard />
		</AppLayout>
	);
}
