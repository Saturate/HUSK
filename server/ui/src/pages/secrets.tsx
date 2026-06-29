import { AppLayout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { Link } from "react-router";

interface SecretFinding {
	span_id: string;
	trace_id: string;
	span_name: string;
	tool_name: string | null;
	detector: string;
	secret_type: string;
	redacted_match: string;
	verified: boolean;
	field: string;
	started_at: string;
}

interface ScanResult {
	scanner?: string;
	traces_scanned?: number;
	total_findings: number;
	traces_with_findings: number;
	last_scan?: string | null;
	results: Array<{
		trace_id: string;
		project: string | null;
		finding_count: number;
		findings: SecretFinding[];
	}>;
}

async function fetchCachedFindings(): Promise<ScanResult> {
	const res = await fetch("/telemetry/secrets", {
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
	});
	if (res.status === 401) throw new Error("Unauthorized");
	if (!res.ok) throw new Error("Failed to load findings");
	return res.json();
}

async function triggerRescan(limit: number): Promise<ScanResult> {
	const res = await fetch(`/telemetry/secrets/rescan?limit=${limit}`, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
	});
	if (!res.ok) throw new Error("Rescan failed");
	return res.json();
}

export function SecretsPage() {
	const queryClient = useQueryClient();
	const cachedQuery = useQuery({
		queryKey: ["secrets", "cached"],
		queryFn: fetchCachedFindings,
	});

	const rescanMutation = useMutation({
		mutationFn: triggerRescan,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["secrets", "cached"] });
		},
	});

	const data = cachedQuery.data;

	return (
		<AppLayout>
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h2 className="text-2xl font-semibold">Secret Scanning</h2>
					<p className="text-sm text-muted-foreground">
						Cached results from trufflehog. Rescan to check for new findings.
						{data?.last_scan && (
							<span className="ml-2">Last scan: {new Date(data.last_scan).toLocaleString()}</span>
						)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						onClick={() => rescanMutation.mutate(50)}
						disabled={rescanMutation.isPending}
						variant="outline"
						size="sm"
					>
						Quick scan
					</Button>
					<Button
						onClick={() => rescanMutation.mutate(9999)}
						disabled={rescanMutation.isPending}
						variant="outline"
						size="sm"
					>
						Full scan
					</Button>
					{rescanMutation.isPending && (
						<span className="text-xs text-muted-foreground">Scanning...</span>
					)}
				</div>
			</div>

			{cachedQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">Scanning traces...</p>
			) : cachedQuery.isError ? (
				<p className="text-sm text-destructive">Scan failed. Is the server running?</p>
			) : data ? (
				<>
					{/* Summary cards */}
					<div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
						<SummaryCard label="Scanner" value={data.scanner ?? "trufflehog"} />
						<SummaryCard label="Traces scanned" value={String(data.traces_scanned ?? "-")} />
						<SummaryCard
							label="Findings"
							value={String(data.total_findings)}
							variant={data.total_findings > 0 ? "destructive" : "default"}
						/>
						<SummaryCard
							label="Affected traces"
							value={String(data.traces_with_findings)}
							variant={data.traces_with_findings > 0 ? "destructive" : "default"}
						/>
					</div>

					{data.total_findings === 0 ? (
						<div className="rounded-lg border bg-card p-8 text-center">
							<ShieldAlert className="mx-auto mb-3 h-10 w-10 text-green-500" />
							<p className="text-lg font-medium">No secrets detected</p>
							<p className="text-sm text-muted-foreground">
								Scanned {data.traces_scanned} recent traces using {data.scanner}.
							</p>
						</div>
					) : (
						<div className="space-y-4">
							{data.results.map((r) => (
								<div key={r.trace_id} className="rounded-lg border bg-card p-4">
									<div className="mb-3 flex items-center gap-2">
										<Link
											to={`/tracing/${r.trace_id}`}
											className="text-sm font-medium hover:underline"
										>
											{r.project ?? r.trace_id.slice(0, 16)}
										</Link>
										<Badge variant="destructive">
											{r.finding_count} finding{r.finding_count > 1 ? "s" : ""}
										</Badge>
									</div>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Type</TableHead>
												<TableHead>Redacted</TableHead>
												<TableHead>Tool</TableHead>
												<TableHead>Verified</TableHead>
												<TableHead>When</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{r.findings.map((f, i) => (
												<TableRow key={`${f.span_id}-${i}`}>
													<TableCell className="text-sm font-medium">{f.secret_type}</TableCell>
													<TableCell className="font-mono text-xs">{f.redacted_match}</TableCell>
													<TableCell className="text-sm text-muted-foreground">
														{f.tool_name ?? f.span_name}
													</TableCell>
													<TableCell>
														{f.verified ? (
															<Badge variant="destructive">Verified</Badge>
														) : (
															<span className="text-xs text-muted-foreground">unverified</span>
														)}
													</TableCell>
													<TableCell className="text-xs text-muted-foreground">
														{f.started_at?.slice(0, 16)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							))}
						</div>
					)}
				</>
			) : null}
		</AppLayout>
	);
}

function SummaryCard({
	label,
	value,
	variant,
}: { label: string; value: string; variant?: "default" | "destructive" }) {
	return (
		<div className="rounded-lg border bg-card p-3">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div
				className={`text-lg font-semibold ${variant === "destructive" ? "text-destructive" : ""}`}
			>
				{value}
			</div>
		</div>
	);
}
