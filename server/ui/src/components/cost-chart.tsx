import type { DailyCost } from "@/api";

const BAR_GAP = 2;
const CHART_HEIGHT = 160;
const LABEL_HEIGHT = 20;
const Y_LABEL_WIDTH = 40;

export function CostChart({ data }: { data: DailyCost[] }) {
	if (data.length === 0) {
		return (
			<div className="flex h-40 items-center justify-center rounded-lg border border-dashed">
				<p className="text-sm text-muted-foreground">No cost data yet.</p>
			</div>
		);
	}

	const maxCost = Math.max(...data.map((d) => d.total_cost_usd), 0.01);
	const totalWidth = Y_LABEL_WIDTH + data.length * 32;
	const totalHeight = CHART_HEIGHT + LABEL_HEIGHT + 10;

	return (
		<div className="overflow-x-auto rounded-lg border p-4">
			<svg
				viewBox={`0 0 ${totalWidth} ${totalHeight}`}
				className="w-full"
				style={{ minWidth: Math.max(300, data.length * 28) }}
				role="img"
				aria-label="Daily cost chart"
			>
				{/* Y-axis labels */}
				<text
					x={Y_LABEL_WIDTH - 4}
					y={12}
					textAnchor="end"
					className="fill-muted-foreground"
					fontSize="9"
				>
					${maxCost.toFixed(2)}
				</text>
				<text
					x={Y_LABEL_WIDTH - 4}
					y={CHART_HEIGHT}
					textAnchor="end"
					className="fill-muted-foreground"
					fontSize="9"
				>
					$0
				</text>
				{/* Grid line */}
				<line
					x1={Y_LABEL_WIDTH}
					y1={CHART_HEIGHT}
					x2={totalWidth}
					y2={CHART_HEIGHT}
					className="stroke-border"
					strokeWidth={1}
				/>

				{data.map((d, i) => {
					const barWidth = 32 - BAR_GAP * 2;
					const barHeight = Math.max(1, (d.total_cost_usd / maxCost) * (CHART_HEIGHT - 12));
					const x = Y_LABEL_WIDTH + i * 32 + BAR_GAP;
					const y = CHART_HEIGHT - barHeight;
					const dateLabel = d.date.slice(5); // MM-DD

					return (
						<g key={d.date}>
							<rect
								x={x}
								y={y}
								width={barWidth}
								height={barHeight}
								rx={2}
								className="fill-primary/80 hover:fill-primary"
							/>
							<title>
								{d.date}: ${d.total_cost_usd.toFixed(2)} ({d.session_count} sessions)
							</title>
							<text
								x={x + barWidth / 2}
								y={CHART_HEIGHT + LABEL_HEIGHT}
								textAnchor="middle"
								className="fill-muted-foreground"
								fontSize="8"
							>
								{dateLabel}
							</text>
						</g>
					);
				})}
			</svg>
		</div>
	);
}
