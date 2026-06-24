import { api, type ModelDetail } from "@/api";
import { AppLayout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatCost, formatTokens } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";

function ModelCard({ m }: { m: ModelDetail }) {
	return (
		<div className="rounded-lg border bg-card p-4">
			<div className="mb-3 flex items-center gap-2">
				<h3 className="text-sm font-semibold">{m.model}</h3>
				<Badge variant="secondary" className="text-xs">
					{m.session_count} sessions
				</Badge>
			</div>

			<div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
				<div>
					<div className="text-muted-foreground">Cost</div>
					<div className="font-medium">{formatCost(m.total_cost_usd)}</div>
				</div>
				<div>
					<div className="text-muted-foreground">Turns</div>
					<div className="font-medium">{m.total_turns.toLocaleString()}</div>
				</div>
				<div>
					<div className="text-muted-foreground">Cost/turn</div>
					<div className="font-medium">{formatCost(m.avg_cost_per_turn)}</div>
				</div>
				<div>
					<div className="text-muted-foreground">Cache hit rate</div>
					<div className="font-medium">{m.cache_hit_rate ? `${(m.cache_hit_rate * 100).toFixed(1)}%` : "n/a"}</div>
				</div>
			</div>

			<div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
				<div>
					<div className="text-muted-foreground">Avg output/turn</div>
					<div className="font-medium">{formatTokens(m.avg_output_per_turn)}</div>
				</div>
				<div>
					<div className="text-muted-foreground">Avg input/turn</div>
					<div className="font-medium">{formatTokens(m.avg_input_per_turn)}</div>
				</div>
				<div>
					<div className="text-muted-foreground">Total input</div>
					<div className="font-medium">{formatTokens(m.total_input_tokens)}</div>
				</div>
				<div>
					<div className="text-muted-foreground">Total output</div>
					<div className="font-medium">{formatTokens(m.total_output_tokens)}</div>
				</div>
			</div>
		</div>
	);
}

export function ModelsPage() {
	const modelsQuery = useQuery({
		queryKey: ["telemetry", "models", "detail"],
		queryFn: () => api.getModelDetails(),
	});

	const models = modelsQuery.data ?? [];

	return (
		<AppLayout>
			<h2 className="mb-6 text-2xl font-semibold">Models</h2>

			{modelsQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">Loading...</p>
			) : models.length === 0 ? (
				<p className="text-sm text-muted-foreground">No model data yet.</p>
			) : (
				<>
					{/* Cards view */}
					<div className="mb-8 space-y-4">
						{models.map((m) => (
							<ModelCard key={m.model} m={m} />
						))}
					</div>

					{/* Comparison table */}
					<h3 className="mb-3 text-lg font-medium">Comparison</h3>
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Model</TableHead>
									<TableHead className="text-right">Sessions</TableHead>
									<TableHead className="text-right">Turns</TableHead>
									<TableHead className="text-right">Avg out/turn</TableHead>
									<TableHead className="text-right">Avg in/turn</TableHead>
									<TableHead className="text-right">Cost/turn</TableHead>
									<TableHead className="text-right">Total cost</TableHead>
									<TableHead className="text-right">Cache hit</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{models.map((m) => (
									<TableRow key={m.model}>
										<TableCell className="text-sm font-medium">{m.model}</TableCell>
										<TableCell className="text-right text-sm">{m.session_count}</TableCell>
										<TableCell className="text-right text-sm">{m.total_turns.toLocaleString()}</TableCell>
										<TableCell className="text-right text-sm font-medium">{formatTokens(m.avg_output_per_turn)}</TableCell>
										<TableCell className="text-right text-sm">{formatTokens(m.avg_input_per_turn)}</TableCell>
										<TableCell className="text-right text-sm">{formatCost(m.avg_cost_per_turn)}</TableCell>
										<TableCell className="text-right text-sm">{formatCost(m.total_cost_usd)}</TableCell>
										<TableCell className="text-right text-sm">
											{m.cache_hit_rate ? `${(m.cache_hit_rate * 100).toFixed(1)}%` : "n/a"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</>
			)}
		</AppLayout>
	);
}
