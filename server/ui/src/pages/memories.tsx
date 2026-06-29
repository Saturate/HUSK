import { api } from "@/api";
import { AppLayout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { relativeTime } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	RotateCcw,
	Search,
	Trash2,
} from "lucide-react";
import { useState } from "react";

const PAGE_SIZE = 20;
const ALL = "__all__";

const TYPE_COLORS: Record<string, string> = {
	decision: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
	solution: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
	lesson: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
	fact: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
	convention: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200",
	goal: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
	session: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
};

export function MemoriesPage() {
	const queryClient = useQueryClient();
	const [page, setPage] = useState(0);
	const [selectedRemote, setSelectedRemote] = useState(ALL);
	const [selectedScope, setSelectedScope] = useState(ALL);
	const [selectedType, setSelectedType] = useState(ALL);
	const [showDeleted, setShowDeleted] = useState(false);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchInput, setSearchInput] = useState("");

	const filtersQuery = useQuery({
		queryKey: ["filters"],
		queryFn: () => api.getFilters(),
	});

	const memoriesQuery = useQuery({
		queryKey: ["memories", "list", selectedRemote, selectedScope, selectedType, showDeleted, page],
		queryFn: () =>
			api.listMemories({
				git_remote: selectedRemote !== ALL ? selectedRemote : undefined,
				scope: selectedScope !== ALL ? selectedScope : undefined,
				memory_type: selectedType !== ALL ? selectedType : undefined,
				include_deleted: showDeleted || undefined,
				limit: PAGE_SIZE,
				offset: page * PAGE_SIZE,
			}),
		enabled: !searchQuery,
	});

	const searchMutation = useMutation({
		mutationFn: (query: string) =>
			api.searchMemories(query, {
				git_remote: selectedRemote !== ALL ? selectedRemote : undefined,
				scope: selectedScope !== ALL ? selectedScope : undefined,
				limit: 20,
			}),
	});

	const deleteMutation = useMutation({
		mutationFn: (id: string) => api.deleteMemory(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["memories"] });
			queryClient.invalidateQueries({ queryKey: ["filters"] });
		},
	});

	const restoreMutation = useMutation({
		mutationFn: (id: string) => api.restoreMemory(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["memories"] });
		},
	});

	function handleSearch() {
		if (!searchInput.trim()) {
			setSearchQuery("");
			return;
		}
		setSearchQuery(searchInput.trim());
		searchMutation.mutate(searchInput.trim());
	}

	function clearSearch() {
		setSearchInput("");
		setSearchQuery("");
	}

	const projects = filtersQuery.data?.projects ?? [];
	const scopes = filtersQuery.data?.scopes ?? [];
	const types = filtersQuery.data?.types ?? [];

	const isSearching = !!searchQuery;
	const searchResults = (searchMutation.data?.results ?? []).map((r) => ({
		id: r.memory_id ?? r.id ?? "",
		summary: r.summary ?? "",
		scope: r.scope ?? "",
		git_remote: r.git_remote ?? null,
		memory_type: r.memory_type ?? null,
		title: r.title ?? null,
		path: r.path ?? null,
		created_at: r.created_at ?? "",
		deleted_at: null as string | null,
		score: r.score ?? null,
	}));
	const memories = isSearching ? searchResults : (memoriesQuery.data?.memories ?? []);

	const total = isSearching ? memories.length : (memoriesQuery.data?.total ?? 0);
	const totalPages = Math.ceil(total / PAGE_SIZE);
	const hasFilters =
		selectedRemote !== ALL || selectedScope !== ALL || selectedType !== ALL || showDeleted;

	return (
		<AppLayout>
			<h2 className="mb-6 text-2xl font-semibold">Memories</h2>

			{/* Search bar */}
			<div className="mb-4 flex gap-2">
				<div className="relative flex-1 max-w-md">
					<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						className="pl-9"
						placeholder="Semantic search across memories..."
						value={searchInput}
						onChange={(e) => setSearchInput(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && handleSearch()}
					/>
				</div>
				<Button onClick={handleSearch} disabled={searchMutation.isPending}>
					{searchMutation.isPending ? "Searching..." : "Search"}
				</Button>
				{isSearching && (
					<Button variant="ghost" onClick={clearSearch}>
						Clear
					</Button>
				)}
			</div>

			{/* Filters */}
			<div className="mb-4 flex flex-wrap items-end gap-3">
				<div className="space-y-1">
					<span className="text-xs text-muted-foreground">Project</span>
					<Select
						value={selectedRemote}
						onValueChange={(v) => {
							setSelectedRemote(v);
							setPage(0);
						}}
					>
						<SelectTrigger className="w-48">
							<SelectValue placeholder="All projects" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>All projects</SelectItem>
							{projects.map((p) => (
								<SelectItem key={p} value={p}>
									{p}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1">
					<span className="text-xs text-muted-foreground">Scope</span>
					<Select
						value={selectedScope}
						onValueChange={(v) => {
							setSelectedScope(v);
							setPage(0);
						}}
					>
						<SelectTrigger className="w-36">
							<SelectValue placeholder="All scopes" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>All scopes</SelectItem>
							{scopes.map((s) => (
								<SelectItem key={s} value={s}>
									{s}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1">
					<span className="text-xs text-muted-foreground">Type</span>
					<Select
						value={selectedType}
						onValueChange={(v) => {
							setSelectedType(v);
							setPage(0);
						}}
					>
						<SelectTrigger className="w-36">
							<SelectValue placeholder="All types" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>All types</SelectItem>
							{types.map((t) => (
								<SelectItem key={t} value={t}>
									{t}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<label className="flex items-center gap-1.5 text-sm text-muted-foreground">
					<input
						type="checkbox"
						checked={showDeleted}
						onChange={(e) => {
							setShowDeleted(e.target.checked);
							setPage(0);
						}}
					/>
					Deleted
				</label>
				{hasFilters && (
					<Button
						size="sm"
						variant="ghost"
						onClick={() => {
							setSelectedRemote(ALL);
							setSelectedScope(ALL);
							setSelectedType(ALL);
							setShowDeleted(false);
							setPage(0);
						}}
					>
						Clear filters
					</Button>
				)}
				<p className="ml-auto text-sm text-muted-foreground">
					{total} {total === 1 ? "memory" : "memories"}
				</p>
			</div>

			{memoriesQuery.isLoading && !isSearching ? (
				<p className="text-sm text-muted-foreground">Loading...</p>
			) : memories.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
					<p className="text-sm text-muted-foreground">
						{isSearching
							? "No results found."
							: hasFilters
								? "No memories match the current filters."
								: "No memories stored yet."}
					</p>
				</div>
			) : (
				<>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-8" />
								<TableHead>Summary</TableHead>
								{isSearching && <TableHead className="w-16">Score</TableHead>}
								<TableHead>Type</TableHead>
								<TableHead>Project</TableHead>
								<TableHead>Scope</TableHead>
								<TableHead>Created</TableHead>
								<TableHead className="w-[50px]" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{memories.map((m) => {
								const isExpanded = expandedId === m.id;
								const isDeleted = m.deleted_at != null;
								return (
									<>
										<TableRow
											key={m.id}
											className={`cursor-pointer ${isDeleted ? "opacity-50" : ""} ${isExpanded ? "border-b-0" : ""}`}
											onClick={() => setExpandedId(isExpanded ? null : m.id)}
										>
											<TableCell className="w-8">
												{isExpanded ? (
													<ChevronUp className="h-4 w-4 text-muted-foreground" />
												) : (
													<ChevronDown className="h-4 w-4 text-muted-foreground" />
												)}
											</TableCell>
											<TableCell className="max-w-[400px]">
												{m.title && <span className="font-medium">{m.title} </span>}
												<span className="text-sm text-muted-foreground truncate block">
													{m.summary.slice(0, 120)}
												</span>
											</TableCell>
											{isSearching && (
												<TableCell className="text-xs text-muted-foreground">
													{(m as { score?: number }).score?.toFixed(3)}
												</TableCell>
											)}
											<TableCell>
												{m.memory_type && (
													<Badge variant="secondary" className={TYPE_COLORS[m.memory_type] ?? ""}>
														{m.memory_type}
													</Badge>
												)}
											</TableCell>
											<TableCell className="max-w-[150px] truncate text-sm text-muted-foreground">
												{m.git_remote ?? "—"}
											</TableCell>
											<TableCell>
												<Badge variant="secondary">{m.scope}</Badge>
											</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{relativeTime(m.created_at)}
											</TableCell>
											<TableCell>
												{isDeleted ? (
													<Button
														size="icon"
														variant="ghost"
														onClick={(e) => {
															e.stopPropagation();
															restoreMutation.mutate(m.id);
														}}
													>
														<RotateCcw className="h-4 w-4" />
													</Button>
												) : (
													<Button
														size="icon"
														variant="ghost"
														onClick={(e) => {
															e.stopPropagation();
															deleteMutation.mutate(m.id);
														}}
													>
														<Trash2 className="h-4 w-4" />
													</Button>
												)}
											</TableCell>
										</TableRow>
										{isExpanded && (
											<TableRow key={`${m.id}-detail`}>
												<TableCell />
												<TableCell colSpan={isSearching ? 7 : 6} className="pb-4">
													<div className="rounded-md bg-muted/50 p-4 font-mono text-sm whitespace-pre-wrap">
														{m.summary}
													</div>
												</TableCell>
											</TableRow>
										)}
									</>
								);
							})}
						</TableBody>
					</Table>

					{!isSearching && totalPages > 1 && (
						<div className="mt-4 flex items-center justify-center gap-2">
							<Button
								size="sm"
								variant="outline"
								disabled={page === 0}
								onClick={() => setPage((p) => p - 1)}
							>
								<ChevronLeft className="h-4 w-4" />
							</Button>
							<span className="text-sm text-muted-foreground">
								Page {page + 1} of {totalPages}
							</span>
							<Button
								size="sm"
								variant="outline"
								disabled={page >= totalPages - 1}
								onClick={() => setPage((p) => p + 1)}
							>
								<ChevronRight className="h-4 w-4" />
							</Button>
						</div>
					)}
				</>
			)}
		</AppLayout>
	);
}
