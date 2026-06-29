import { api } from "@/api";
import { StatCard } from "@/components/stat-card";
import { formatCost } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";

export function CostOverviewCards() {
	const { data: overview } = useQuery({
		queryKey: ["telemetry", "overview"],
		queryFn: () => api.getTelemetryOverview(),
	});

	return (
		<div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
			<StatCard
				label="Today"
				value={overview ? formatCost(overview.today.cost) : "..."}
				subtitle={
					overview
						? `${overview.today.sessions} sessions, ${overview.today.turns} turns`
						: undefined
				}
			/>
			<StatCard
				label="This week"
				value={overview ? formatCost(overview.week.cost) : "..."}
				subtitle={
					overview ? `${overview.week.sessions} sessions, ${overview.week.turns} turns` : undefined
				}
			/>
			<StatCard
				label="This month"
				value={overview ? formatCost(overview.month.cost) : "..."}
				subtitle={
					overview
						? `${overview.month.sessions} sessions, ${overview.month.turns} turns`
						: undefined
				}
			/>
		</div>
	);
}
