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
import { useState } from "react";

const FAMILY_COLORS: Record<string, string> = {
	"opus-4-8": "bg-red-500",
	"opus-4-6": "bg-blue-500",
	"haiku-4-5": "bg-green-500",
	"fable-5": "bg-purple-500",
	"sonnet-4-6": "bg-amber-500",
};
const DEFAULT_COLOR = "bg-cyan-500";

interface ModelFamily {
	family: string;
	color: string;
	combined: ModelDetail;
	variants: ModelDetail[];
}

function getFamily(model: string): string {
	return model
		.replace("claude-", "")
		.replace(/\[1m\]$/, "")
		.replace(/-\d{8}$/, "");
}

function groupIntoFamilies(models: ModelDetail[]): ModelFamily[] {
	const map = new Map<string, ModelDetail[]>();
	for (const m of models) {
		const fam = getFamily(m.model);
		const list = map.get(fam) ?? [];
		list.push(m);
		map.set(fam, list);
	}

	const families: ModelFamily[] = [];
	for (const [family, variants] of map) {
		const combined: ModelDetail = {
			model: family,
			session_count: variants.reduce((s, v) => s + v.session_count, 0),
			total_turns: variants.reduce((s, v) => s + v.total_turns, 0),
			total_input_tokens: variants.reduce((s, v) => s + v.total_input_tokens, 0),
			total_output_tokens: variants.reduce((s, v) => s + v.total_output_tokens, 0),
			total_cache_read_tokens: variants.reduce((s, v) => s + v.total_cache_read_tokens, 0),
			total_cache_create_tokens: variants.reduce((s, v) => s + v.total_cache_create_tokens, 0),
			total_cost_usd: variants.reduce((s, v) => s + v.total_cost_usd, 0),
			avg_output_per_turn: 0,
			avg_input_per_turn: 0,
			avg_cost_per_turn: 0,
			cache_hit_rate: 0,
		};
		if (combined.total_turns > 0) {
			combined.avg_output_per_turn = Math.round(combined.total_output_tokens / combined.total_turns);
			combined.avg_input_per_turn = Math.round(combined.total_input_tokens / combined.total_turns);
			combined.avg_cost_per_turn = combined.total_cost_usd / combined.total_turns;
		}
		const totalCacheBase = combined.total_cache_read_tokens + combined.total_cache_create_tokens + combined.total_input_tokens;
		combined.cache_hit_rate = totalCacheBase > 0 ? combined.total_cache_read_tokens / totalCacheBase : 0;

		families.push({
			family,
			color: FAMILY_COLORS[family] ?? DEFAULT_COLOR,
			combined,
			variants: variants.sort((a, b) => b.total_turns - a.total_turns),
		});
	}

	return families.sort((a, b) => b.combined.total_cost_usd - a.combined.total_cost_usd);
}

function ComparisonChart({
	title,
	families,
	getValue,
	formatFn,
	showVariants,
}: {
	title: string;
	families: ModelFamily[];
	getValue: (m: ModelDetail) => number;
	formatFn: (n: number) => string;
	showVariants: boolean;
}) {
	const max = Math.max(...families.map((f) => getValue(f.combined)));
	if (max === 0) return null;

	return (
		<div className="mb-8">
			<h3 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wider">{title}</h3>
			<div className="space-y-1">
				{families.map((f) => {
					const val = getValue(f.combined);
					const pct = (val / max) * 100;
					return (
						<div key={f.family}>
							{/* Family bar */}
							<div className="flex items-center gap-3">
								<div className="w-28 shrink-0 truncate text-right text-sm font-medium" title={f.family}>
									{f.family}
								</div>
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<div className="h-7 flex-1 overflow-hidden rounded bg-muted">
											<div
												className={`h-full rounded ${f.color} flex items-center`}
												style={{ width: `${pct}%`, minWidth: pct > 0 ? "2px" : "0" }}
											>
												{pct > 20 && (
													<span className="px-2 text-xs font-semibold text-white">{formatFn(val)}</span>
												)}
											</div>
										</div>
										{pct <= 20 && (
											<span className="shrink-0 text-xs text-muted-foreground">{formatFn(val)}</span>
										)}
									</div>
								</div>
							</div>
							{/* Variant sub-bars */}
							{showVariants && f.variants.length > 1 && f.variants.map((v) => {
								const vval = getValue(v);
								const vpct = (vval / max) * 100;
								const label = v.model.replace("claude-", "");
								return (
									<div key={v.model} className="flex items-center gap-3 ml-4">
										<div className="w-24 shrink-0 truncate text-right text-xs text-muted-foreground" title={v.model}>
											{label}
										</div>
										<div className="flex-1">
											<div className="flex items-center gap-2">
												<div className="h-3.5 flex-1 overflow-hidden rounded bg-muted">
													<div
														className={`h-full rounded ${f.color} opacity-60`}
														style={{ width: `${vpct}%`, minWidth: vpct > 0 ? "2px" : "0" }}
													/>
												</div>
												<span className="shrink-0 text-xs text-muted-foreground">{formatFn(vval)}</span>
											</div>
										</div>
									</div>
								);
							})}
						</div>
					);
				})}
			</div>
		</div>
	);
}

export function ModelsPage() {
	const modelsQuery = useQuery({
		queryKey: ["telemetry", "models", "detail"],
		queryFn: () => api.getModelDetails(),
	});

	const [showVariants, setShowVariants] = useState(false);
	const allModels = modelsQuery.data ?? [];
	const meaningful = allModels.filter((m) => m.total_turns >= 100);
	const families = groupIntoFamilies(meaningful);

	return (
		<AppLayout>
			<h2 className="mb-2 text-2xl font-semibold">Models</h2>
			<p className="mb-6 text-sm text-muted-foreground">
				Model families compared (100+ turns). Variants like [1m] shown as sub-bars.
			</p>

			{modelsQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">Loading...</p>
			) : families.length === 0 ? (
				<p className="text-sm text-muted-foreground">No model data yet.</p>
			) : (
				<>
					<div className="mb-10 rounded-lg border bg-card p-6">
						<div className="mb-4 flex items-center justify-end">
							<button
								onClick={() => setShowVariants(!showVariants)}
								className="text-xs text-muted-foreground hover:text-foreground transition-colors"
							>
								{showVariants ? "Hide variants" : "Show variants"}
							</button>
						</div>
						<ComparisonChart
							title="Output tokens per turn"
							families={families} showVariants={showVariants}
							getValue={(m) => m.avg_output_per_turn}
							formatFn={(n) => formatTokens(n) + " tok"}
						/>
						<ComparisonChart
							title="Cost per turn"
							families={families} showVariants={showVariants}
							getValue={(m) => m.avg_cost_per_turn}
							formatFn={formatCost}
						/>
						<ComparisonChart
							title="Cache hit rate"
							families={families} showVariants={showVariants}
							getValue={(m) => m.cache_hit_rate * 100}
							formatFn={(n) => `${n.toFixed(1)}%`}
						/>
						<ComparisonChart
							title="Total cost"
							families={families} showVariants={showVariants}
							getValue={(m) => m.total_cost_usd}
							formatFn={formatCost}
						/>
					</div>

					<h3 className="mb-3 text-lg font-medium">All variants</h3>
					<ModelTable models={allModels} />
				</>
			)}
		</AppLayout>
	);
}

function ModelTable({ models }: { models: ModelDetail[] }) {
	return (
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
	);
}
