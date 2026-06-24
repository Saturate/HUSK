import { api, type ModelDetail } from "@/api";
import { AppLayout } from "@/components/layout";
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

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
	const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
	return (
		<div className="flex items-center gap-2">
			<div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
				<div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
			</div>
		</div>
	);
}

function MetricRow({
	label,
	models,
	getValue,
	formatFn,
	color,
}: {
	label: string;
	models: ModelDetail[];
	getValue: (m: ModelDetail) => number;
	formatFn: (n: number) => string;
	color: string;
}) {
	const max = Math.max(...models.map(getValue));
	return (
		<>
			<tr>
				<td colSpan={models.length + 1} className="pb-1 pt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
					{label}
				</td>
			</tr>
			<tr>
				<td />
				{models.map((m) => {
					const val = getValue(m);
					return (
						<td key={m.model} className="px-3 pb-2">
							<div className="mb-1 text-sm font-medium">{formatFn(val)}</div>
							<Bar value={val} max={max} color={color} />
						</td>
					);
				})}
			</tr>
		</>
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
					{/* Visual comparison */}
					<div className="mb-10 overflow-x-auto">
						<table className="w-full">
							<thead>
								<tr>
									<th className="w-40" />
									{models.map((m) => (
										<th key={m.model} className="px-3 pb-3 text-left">
											<div className="text-sm font-semibold">{m.model}</div>
											<div className="text-xs text-muted-foreground">
												{m.session_count} sessions, {m.total_turns.toLocaleString()} turns
											</div>
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								<MetricRow
									label="Output tokens / turn"
									models={models}
									getValue={(m) => m.avg_output_per_turn}
									formatFn={formatTokens}
									color="bg-red-500"
								/>
								<MetricRow
									label="Input tokens / turn"
									models={models}
									getValue={(m) => m.avg_input_per_turn}
									formatFn={formatTokens}
									color="bg-blue-500"
								/>
								<MetricRow
									label="Cost / turn"
									models={models}
									getValue={(m) => m.avg_cost_per_turn}
									formatFn={formatCost}
									color="bg-amber-500"
								/>
								<MetricRow
									label="Total cost"
									models={models}
									getValue={(m) => m.total_cost_usd}
									formatFn={formatCost}
									color="bg-amber-500"
								/>
								<MetricRow
									label="Cache hit rate"
									models={models}
									getValue={(m) => m.cache_hit_rate * 100}
									formatFn={(n) => `${n.toFixed(1)}%`}
									color="bg-green-500"
								/>
								<MetricRow
									label="Total output tokens"
									models={models}
									getValue={(m) => m.total_output_tokens}
									formatFn={formatTokens}
									color="bg-red-500/70"
								/>
							</tbody>
						</table>
					</div>

					{/* Detail table */}
					<h3 className="mb-3 text-lg font-medium">Raw numbers</h3>
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
