import { api } from "@/api";
import { formatCost, formatTokens } from "@/lib/format";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";

export function ModelsSection() {
	const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

	const { data, isLoading } = useQuery({
		queryKey: ["telemetry", "models", thirtyDaysAgo],
		queryFn: () => api.getTelemetryModels(thirtyDaysAgo),
	});

	return (
		<div className="mb-8">
			<h3 className="mb-3 text-lg font-medium">Model comparison</h3>
			{isLoading ? (
				<p className="text-sm text-muted-foreground">Loading...</p>
			) : (data?.length ?? 0) === 0 ? (
				<p className="text-sm text-muted-foreground">No model data yet.</p>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Model</TableHead>
							<TableHead className="text-right">Cost</TableHead>
							<TableHead className="text-right">Sessions</TableHead>
							<TableHead className="text-right">Input tokens</TableHead>
							<TableHead className="text-right">Output tokens</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data?.map((m) => (
							<TableRow key={m.model}>
								<TableCell className="text-sm font-medium">{m.model}</TableCell>
								<TableCell className="text-right text-sm">
									{formatCost(m.total_cost_usd)}
								</TableCell>
								<TableCell className="text-right text-sm text-muted-foreground">
									{m.session_count}
								</TableCell>
								<TableCell className="text-right text-sm text-muted-foreground">
									{formatTokens(m.total_input_tokens)}
								</TableCell>
								<TableCell className="text-right text-sm text-muted-foreground">
									{formatTokens(m.total_output_tokens)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</div>
	);
}
