import { api } from "@/api";
import { CostChart } from "@/components/cost-chart";
import { useQuery } from "@tanstack/react-query";

export function DailyCostSection() {
	const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

	const { data, isLoading } = useQuery({
		queryKey: ["telemetry", "daily", thirtyDaysAgo],
		queryFn: () => api.getTelemetryDaily(thirtyDaysAgo),
	});

	return (
		<div className="mb-8">
			<h3 className="mb-3 text-lg font-medium">Daily cost (30 days)</h3>
			{isLoading ? (
				<p className="text-sm text-muted-foreground">Loading...</p>
			) : (
				<CostChart data={data ?? []} />
			)}
		</div>
	);
}
