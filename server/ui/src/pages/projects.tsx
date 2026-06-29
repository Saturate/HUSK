import { type ProjectCost, api } from "@/api";
import { AppLayout } from "@/components/layout";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatCost } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import {
	type ColumnDef,
	type SortingState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

function timeAgo(iso: string | null): string {
	if (!iso) return "-";
	const parsed = iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`;
	const diff = Date.now() - new Date(parsed).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(iso).toLocaleDateString();
}

const columns: ColumnDef<ProjectCost>[] = [
	{
		accessorKey: "project",
		header: "Project",
		cell: ({ row }) => <span className="font-medium">{row.getValue("project")}</span>,
	},
	{
		accessorKey: "total_cost_usd",
		header: ({ column }) => (
			<button
				type="button"
				className="flex items-center gap-1 ml-auto"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
			>
				Cost <ArrowUpDown className="h-3 w-3" />
			</button>
		),
		cell: ({ row }) => (
			<div className="text-right">{formatCost(row.getValue("total_cost_usd"))}</div>
		),
	},
	{
		accessorKey: "session_count",
		header: ({ column }) => (
			<button
				type="button"
				className="flex items-center gap-1 ml-auto"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
			>
				Sessions <ArrowUpDown className="h-3 w-3" />
			</button>
		),
		cell: ({ row }) => (
			<div className="text-right text-muted-foreground">{row.getValue("session_count")}</div>
		),
	},
	{
		accessorKey: "total_turns",
		header: ({ column }) => (
			<button
				type="button"
				className="flex items-center gap-1 ml-auto"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
			>
				Turns <ArrowUpDown className="h-3 w-3" />
			</button>
		),
		cell: ({ row }) => (
			<div className="text-right text-muted-foreground">
				{(row.getValue("total_turns") as number).toLocaleString()}
			</div>
		),
	},
	{
		accessorKey: "last_active",
		header: ({ column }) => (
			<button
				type="button"
				className="flex items-center gap-1 ml-auto"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
			>
				Last active <ArrowUpDown className="h-3 w-3" />
			</button>
		),
		cell: ({ row }) => (
			<div className="text-right text-muted-foreground">{timeAgo(row.getValue("last_active"))}</div>
		),
		sortingFn: (a, b) => {
			const aVal = a.getValue("last_active") as string | null;
			const bVal = b.getValue("last_active") as string | null;
			if (!aVal && !bVal) return 0;
			if (!aVal) return 1;
			if (!bVal) return -1;
			return aVal.localeCompare(bVal);
		},
	},
];

export function ProjectsPage() {
	const navigate = useNavigate();
	const [sorting, setSorting] = useState<SortingState>([{ id: "last_active", desc: true }]);
	const [globalFilter, setGlobalFilter] = useState("");

	const { data, isLoading } = useQuery({
		queryKey: ["telemetry", "projects"],
		queryFn: () => api.getTelemetryProjects(),
	});

	const table = useReactTable({
		data: data ?? [],
		columns,
		state: { sorting, globalFilter },
		onSortingChange: setSorting,
		onGlobalFilterChange: setGlobalFilter,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		globalFilterFn: (row, _columnId, filterValue) => {
			return (row.getValue("project") as string)
				.toLowerCase()
				.includes((filterValue as string).toLowerCase());
		},
	});

	return (
		<AppLayout>
			<div className="mb-6 flex items-center justify-between">
				<h2 className="text-2xl font-semibold">Projects</h2>
				<Input
					placeholder="Filter projects..."
					value={globalFilter}
					onChange={(e) => setGlobalFilter(e.target.value)}
					className="max-w-xs"
				/>
			</div>

			{isLoading ? (
				<p className="text-sm text-muted-foreground">Loading...</p>
			) : (data?.length ?? 0) === 0 ? (
				<p className="text-sm text-muted-foreground">No project data yet.</p>
			) : (
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead key={header.id}>
										{header.isPlaceholder
											? null
											: flexRender(header.column.columnDef.header, header.getContext())}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows.map((row) => (
							<TableRow
								key={row.id}
								className="cursor-pointer hover:bg-muted/50"
								onClick={() =>
									navigate(`/tracing?project=${encodeURIComponent(row.getValue("project"))}`)
								}
							>
								{row.getVisibleCells().map((cell) => (
									<TableCell key={cell.id} className="text-sm">
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</AppLayout>
	);
}
