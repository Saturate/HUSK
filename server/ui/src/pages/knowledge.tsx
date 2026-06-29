import { type KnowledgeTreeProject, type KnowledgeTreeWorkspace, type Memory, api } from "@/api";
import { AppSidebar, SidebarProvider, useSidebar } from "@/components/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BookOpen,
	Boxes,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Code,
	FileText,
	Folder,
	FolderOpen,
	Lightbulb,
	Menu,
	MessageSquare,
	NotebookPen,
	Pin,
	Rocket,
	RotateCcw,
	Ruler,
	Search,
	Target,
	Text,
	Trash2,
	X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import { useSearchParams } from "react-router";

const TYPE_COLORS: Record<string, string> = {
	decision: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
	solution: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
	lesson: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
	fact: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
	convention: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200",
	goal: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
	session: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
	untyped: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const TYPE_ICONS: Record<string, LucideIcon> = {
	decision: Lightbulb,
	solution: CheckCircle2,
	lesson: NotebookPen,
	fact: Pin,
	convention: Ruler,
	goal: Target,
	session: MessageSquare,
};

function shortProject(remote: string): string {
	if (remote === "__general__") return "General";
	return remote
		.replace(/^https?:\/\//, "")
		.replace(/\.git$/, "")
		.replace(/^github\.com\//, "");
}

interface TreeSelection {
	project: string | null;
	type: string | null;
	memoryId: string | null;
}

function TypeNode({
	type,
	count,
	selected,
	onSelect,
	memories,
	selectedMemoryId,
	onSelectMemory,
}: {
	type: string;
	count: number;
	selected: boolean;
	onSelect: () => void;
	memories: Memory[];
	selectedMemoryId: string | null;
	onSelectMemory: (id: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const isExpanded = expanded || selected;

	return (
		<div>
			<button
				type="button"
				className={cn(
					"flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-accent/50 transition-colors",
					selected && !selectedMemoryId && "bg-accent text-accent-foreground",
				)}
				onClick={() => {
					setExpanded(!isExpanded);
					onSelect();
				}}
			>
				{isExpanded ? (
					<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				) : (
					<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				)}
				{(() => {
					const Icon = TYPE_ICONS[type] ?? Rocket;
					return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
				})()}
				<span className="flex-1 truncate capitalize">{type === "untyped" ? "Other" : type}s</span>
				<span className="shrink-0 text-xs text-muted-foreground">{count}</span>
			</button>
			{isExpanded && memories.length > 0 && (
				<div className="ml-4 border-l border-border/50 pl-1">
					{memories.map((m) => (
						<button
							type="button"
							key={m.id}
							className={cn(
								"flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-accent/50 transition-colors",
								selectedMemoryId === m.id && "bg-accent text-accent-foreground",
							)}
							onClick={(e) => {
								e.stopPropagation();
								onSelectMemory(m.id);
							}}
						>
							<FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
							<span className="flex-1 truncate">{m.title || m.summary.slice(0, 50)}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function ProjectNode({
	project,
	types,
	selection,
	onSelectType,
	onSelectMemory,
	memories,
}: {
	project: KnowledgeTreeProject;
	types: [string, number][];
	selection: TreeSelection;
	onSelectType: (project: string, type: string) => void;
	onSelectMemory: (id: string) => void;
	memories: Memory[];
}) {
	const [expanded, setExpanded] = useState(
		project.project === "__general__" || selection.project === project.project,
	);
	const isSelected = selection.project === project.project;
	const label = shortProject(project.project);

	return (
		<div>
			<button
				type="button"
				className={cn(
					"flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-accent/50 transition-colors",
					isSelected && !selection.type && "bg-accent text-accent-foreground",
				)}
				onClick={() => setExpanded(!expanded)}
			>
				{expanded ? (
					<FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
				) : (
					<Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
				)}
				<span className="flex-1 truncate">{label}</span>
				<span className="shrink-0 text-xs text-muted-foreground">{project.total}</span>
			</button>
			{expanded && (
				<div className="ml-3">
					{types.map(([type, count]) => (
						<TypeNode
							key={type}
							type={type}
							count={count}
							selected={isSelected && selection.type === type}
							onSelect={() => onSelectType(project.project, type)}
							memories={isSelected && selection.type === type ? memories : []}
							selectedMemoryId={selection.memoryId}
							onSelectMemory={onSelectMemory}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function WorkspaceNode({
	workspace,
	selection,
	onSelectType,
	onSelectMemory,
	memories,
}: {
	workspace: KnowledgeTreeWorkspace;
	selection: TreeSelection;
	onSelectType: (project: string, type: string) => void;
	onSelectMemory: (id: string) => void;
	memories: Memory[];
}) {
	const hasSelectedProject = workspace.projects.some((p) => p.project === selection.project);
	const [expanded, setExpanded] = useState(hasSelectedProject);
	const label = workspace.workspace === "__unassigned__" ? "Other Projects" : workspace.workspace;

	return (
		<div>
			<button
				type="button"
				className="flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/30 transition-colors"
				onClick={() => setExpanded(!expanded)}
			>
				{expanded ? (
					<ChevronDown className="h-3.5 w-3.5 shrink-0" />
				) : (
					<ChevronRight className="h-3.5 w-3.5 shrink-0" />
				)}
				<Boxes className="h-3.5 w-3.5 shrink-0" />
				<span className="flex-1 truncate">{label}</span>
				<span className="shrink-0 text-[10px] font-normal">{workspace.total}</span>
			</button>
			{expanded && (
				<div className="ml-2">
					{workspace.projects.map((project) => (
						<ProjectNode
							key={project.project}
							project={project}
							types={Object.entries(project.types).sort(([a], [b]) => a.localeCompare(b))}
							selection={selection}
							onSelectType={onSelectType}
							onSelectMemory={onSelectMemory}
							memories={selection.project === project.project && selection.type ? memories : []}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function MemoryContentView({
	memory,
	onDelete,
	onRestore,
}: {
	memory: Memory;
	onDelete: (id: string) => void;
	onRestore: (id: string) => void;
}) {
	const isDeleted = memory.deleted_at != null;
	const [viewMode, setViewMode] = useState<"markdown" | "raw">("markdown");

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="shrink-0 border-b px-6 py-4">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0 flex-1">
						<h2 className="text-lg font-semibold leading-tight">
							{memory.title || "Untitled Memory"}
						</h2>
						{memory.path && (
							<p className="mt-1 text-xs font-mono text-muted-foreground">{memory.path}</p>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<div className="flex rounded-md border border-border">
							<button
								type="button"
								className={cn(
									"flex items-center gap-1 rounded-l-md px-2 py-1 text-xs transition-colors",
									viewMode === "markdown"
										? "bg-accent text-accent-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
								onClick={() => setViewMode("markdown")}
								title="Rendered markdown"
							>
								<Text className="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								className={cn(
									"flex items-center gap-1 rounded-r-md px-2 py-1 text-xs transition-colors",
									viewMode === "raw"
										? "bg-accent text-accent-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
								onClick={() => setViewMode("raw")}
								title="Raw source"
							>
								<Code className="h-3.5 w-3.5" />
							</button>
						</div>
						{isDeleted ? (
							<Button
								size="sm"
								variant="ghost"
								onClick={() => onRestore(memory.id)}
								title="Restore"
							>
								<RotateCcw className="h-4 w-4" />
							</Button>
						) : (
							<Button size="sm" variant="ghost" onClick={() => onDelete(memory.id)} title="Delete">
								<Trash2 className="h-4 w-4" />
							</Button>
						)}
					</div>
				</div>
				<div className="mt-3 flex flex-wrap items-center gap-2">
					{memory.memory_type && (
						<Badge variant="secondary" className={TYPE_COLORS[memory.memory_type] ?? ""}>
							{memory.memory_type}
						</Badge>
					)}
					<Badge variant="secondary">{memory.scope}</Badge>
					{memory.git_remote && (
						<span className="text-xs text-muted-foreground">{shortProject(memory.git_remote)}</span>
					)}
					<span className="ml-auto text-xs text-muted-foreground">
						{relativeTime(memory.created_at)}
					</span>
					{memory.updated_at && (
						<span className="text-xs text-muted-foreground">
							(updated {relativeTime(memory.updated_at)})
						</span>
					)}
				</div>
			</div>

			{/* Body */}
			<div className="flex-1 overflow-y-auto px-6 py-4">
				{viewMode === "markdown" ? (
					<div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-foreground/90 prose-li:text-foreground/90 prose-strong:text-foreground prose-code:text-foreground prose-code:bg-muted prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-a:text-primary prose-a:underline">
						<Markdown>{memory.summary}</Markdown>
					</div>
				) : (
					<pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
						{memory.summary}
					</pre>
				)}
			</div>

			{/* Footer metadata */}
			<div className="shrink-0 border-t px-6 py-2">
				<div className="flex items-center gap-4 text-xs text-muted-foreground">
					<span>ID: {memory.id.slice(0, 8)}</span>
					{memory.slug && <span>Slug: {memory.slug}</span>}
				</div>
			</div>
		</div>
	);
}

function MemoryListView({
	memories,
	title,
	selection,
	onSelectMemory,
}: {
	memories: Memory[];
	title: string;
	selection: TreeSelection;
	onSelectMemory: (id: string) => void;
}) {
	return (
		<div className="flex h-full flex-col">
			<div className="shrink-0 border-b px-6 py-4">
				<h2 className="text-lg font-semibold">{title}</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					{memories.length} {memories.length === 1 ? "memory" : "memories"}
				</p>
			</div>
			<div className="flex-1 overflow-y-auto">
				{memories.map((m) => (
					<button
						type="button"
						key={m.id}
						className={cn(
							"flex w-full flex-col border-b px-6 py-3 text-left hover:bg-accent/30 transition-colors",
							selection.memoryId === m.id && "bg-accent/50",
						)}
						onClick={() => onSelectMemory(m.id)}
					>
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium truncate flex-1">
								{m.title || m.summary.slice(0, 60)}
							</span>
							{m.memory_type && (
								<Badge
									variant="secondary"
									className={cn("text-[10px] shrink-0", TYPE_COLORS[m.memory_type] ?? "")}
								>
									{m.memory_type}
								</Badge>
							)}
						</div>
						<p className="mt-1 text-xs text-muted-foreground line-clamp-2">
							{m.summary.slice(0, 150)}
						</p>
						<span className="mt-1 text-[10px] text-muted-foreground">
							{relativeTime(m.created_at)}
						</span>
					</button>
				))}
			</div>
		</div>
	);
}

function KnowledgeBrowserInner() {
	const { isOpen, isMobile, toggle, close } = useSidebar();
	const queryClient = useQueryClient();
	const [searchParams, setSearchParams] = useSearchParams();

	const selection: TreeSelection = useMemo(
		() => ({
			project: searchParams.get("project"),
			type: searchParams.get("type"),
			memoryId: searchParams.get("id"),
		}),
		[searchParams],
	);

	const setSelection = useCallback(
		(next: TreeSelection | ((prev: TreeSelection) => TreeSelection)) => {
			setSearchParams(
				(prev) => {
					const current: TreeSelection = {
						project: prev.get("project"),
						type: prev.get("type"),
						memoryId: prev.get("id"),
					};
					const resolved = typeof next === "function" ? next(current) : next;
					const p = new URLSearchParams(prev);
					if (resolved.project) p.set("project", resolved.project);
					else p.delete("project");
					if (resolved.type) p.set("type", resolved.type);
					else p.delete("type");
					if (resolved.memoryId) p.set("id", resolved.memoryId);
					else p.delete("id");
					return p;
				},
				{ replace: true },
			);
		},
		[setSearchParams],
	);

	const [searchInput, setSearchInput] = useState(() => searchParams.get("q") ?? "");
	const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") ?? "");
	const [treePanelOpen, setTreePanelOpen] = useState(true);

	const treeQuery = useQuery({
		queryKey: ["knowledge", "tree"],
		queryFn: () => api.getKnowledgeTree(),
	});

	const memoriesQuery = useQuery({
		queryKey: ["knowledge", "memories", selection.project, selection.type],
		queryFn: () =>
			api.listMemories({
				git_remote:
					selection.project && selection.project !== "__general__" ? selection.project : undefined,
				memory_type: selection.type && selection.type !== "untyped" ? selection.type : undefined,
				limit: 200,
			}),
		enabled: selection.project !== null && selection.type !== null,
	});

	const searchMutation = useMutation({
		mutationFn: (query: string) => api.searchMemories(query, { limit: 20 }),
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: fire-once on mount
	useEffect(() => {
		const q = searchParams.get("q");
		if (q && !searchMutation.data) {
			searchMutation.mutate(q);
		}
	}, []);

	const deleteMutation = useMutation({
		mutationFn: (id: string) => api.deleteMemory(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["knowledge"] });
			queryClient.invalidateQueries({ queryKey: ["memories"] });
		},
	});

	const restoreMutation = useMutation({
		mutationFn: (id: string) => api.restoreMemory(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["knowledge"] });
			queryClient.invalidateQueries({ queryKey: ["memories"] });
		},
	});

	const handleSearch = useCallback(() => {
		if (!searchInput.trim()) {
			setSearchQuery("");
			setSearchParams(
				(prev) => {
					const p = new URLSearchParams(prev);
					p.delete("q");
					return p;
				},
				{ replace: true },
			);
			return;
		}
		const q = searchInput.trim();
		setSearchQuery(q);
		setSearchParams(
			(prev) => {
				const p = new URLSearchParams(prev);
				p.set("q", q);
				return p;
			},
			{ replace: true },
		);
		searchMutation.mutate(q);
	}, [searchInput, searchMutation, setSearchParams]);

	const clearSearch = useCallback(() => {
		setSearchInput("");
		setSearchQuery("");
		setSearchParams(
			(prev) => {
				const p = new URLSearchParams(prev);
				p.delete("q");
				return p;
			},
			{ replace: true },
		);
	}, [setSearchParams]);

	const handleSelectType = useCallback(
		(project: string, type: string) => {
			setSelection({ project, type, memoryId: null });
		},
		[setSelection],
	);

	const handleSelectMemory = useCallback(
		(memoryId: string) => {
			setSelection((prev) => ({ ...prev, memoryId }));
		},
		[setSelection],
	);

	const allMemories = useMemo(() => {
		if (!memoriesQuery.data) return [];
		if (!selection.project) return [];
		let filtered = memoriesQuery.data.memories;
		if (selection.project === "__general__") {
			filtered = filtered.filter((m) => !m.git_remote);
		}
		if (selection.type === "untyped") {
			filtered = filtered.filter((m) => !m.memory_type);
		}
		return filtered;
	}, [memoriesQuery.data, selection.project, selection.type]);

	const searchResults = useMemo(() => {
		if (!searchMutation.data) return [];
		return searchMutation.data.results.map((r) => ({
			id: r.memory_id ?? r.id ?? "",
			api_key_id: r.api_key_id,
			summary: r.summary ?? "",
			scope: r.scope ?? "",
			git_remote: r.git_remote ?? null,
			memory_type: r.memory_type ?? null,
			title: r.title ?? null,
			slug: null,
			path: r.path ?? null,
			created_at: r.created_at ?? "",
			deleted_at: null as string | null,
			metadata: r.metadata ?? null,
			workspace_id: null,
			updated_at: null,
			expires_at: null,
		})) as unknown as Memory[];
	}, [searchMutation.data]);

	const selectedMemory = useMemo(() => {
		if (!selection.memoryId) return null;
		const pool = searchQuery ? searchResults : allMemories;
		return pool.find((m) => m.id === selection.memoryId) ?? null;
	}, [selection.memoryId, searchQuery, searchResults, allMemories]);

	const isSearching = !!searchQuery;
	const displayMemories = isSearching ? searchResults : allMemories;

	const treeWorkspaces = treeQuery.data?.workspaces ?? [];
	const treeProjects = treeQuery.data?.projects ?? [];
	const totalMemories = treeProjects.reduce((acc, p) => acc + p.total, 0);

	const currentTitle = useMemo(() => {
		if (isSearching) return `Search: "${searchQuery}"`;
		if (!selection.project) return "Knowledge";
		const label = shortProject(selection.project);
		if (!selection.type) return label;
		const typeName = selection.type === "untyped" ? "Other" : `${selection.type}s`;
		return `${label} / ${typeName}`;
	}, [isSearching, searchQuery, selection]);

	return (
		<div className="flex h-svh">
			<AppSidebar />

			{isMobile && isOpen && (
				<div
					className="fixed inset-0 z-30 bg-black/50"
					onClick={close}
					onKeyDown={(e) => e.key === "Escape" && close()}
				/>
			)}

			<div className="flex flex-1 flex-col overflow-hidden">
				{/* Mobile header */}
				<header className="flex h-12 shrink-0 items-center gap-3 border-b px-4 md:hidden">
					<button
						type="button"
						onClick={toggle}
						className="rounded-md p-1 hover:bg-accent"
						aria-label="Toggle sidebar"
					>
						<Menu className="h-5 w-5" />
					</button>
					<span className="text-sm font-semibold">Knowledge</span>
				</header>

				<div className="flex flex-1 overflow-hidden">
					{/* Tree panel */}
					{treePanelOpen && (
						<div className="flex w-72 shrink-0 flex-col border-r bg-muted/20">
							{/* Search */}
							<div className="shrink-0 border-b p-3">
								<div className="relative">
									<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
									<Input
										className="h-8 pl-8 text-sm"
										placeholder="Search memories..."
										value={searchInput}
										onChange={(e) => setSearchInput(e.target.value)}
										onKeyDown={(e) => e.key === "Enter" && handleSearch()}
									/>
									{isSearching && (
										<button
											type="button"
											className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
											onClick={clearSearch}
										>
											<X className="h-3.5 w-3.5" />
										</button>
									)}
								</div>
							</div>

							{/* Tree header */}
							<div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b">
								<BookOpen className="h-4 w-4 text-muted-foreground" />
								<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
									Knowledge Base
								</span>
								<span className="ml-auto text-xs text-muted-foreground">{totalMemories}</span>
							</div>

							{/* Tree */}
							<div className="flex-1 overflow-y-auto p-2 space-y-0.5">
								{isSearching ? (
									<div className="px-2 py-3">
										{searchMutation.isPending ? (
											<p className="text-xs text-muted-foreground">Searching...</p>
										) : searchResults.length === 0 ? (
											<p className="text-xs text-muted-foreground">No results found.</p>
										) : (
											<div className="space-y-0.5">
												<p className="mb-2 text-xs text-muted-foreground">
													{searchResults.length} results
												</p>
												{searchResults.map((m) => (
													<button
														type="button"
														key={m.id}
														className={cn(
															"flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/50 transition-colors",
															selection.memoryId === m.id && "bg-accent text-accent-foreground",
														)}
														onClick={() => handleSelectMemory(m.id)}
													>
														<FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
														<span className="flex-1 truncate">
															{m.title || m.summary.slice(0, 50)}
														</span>
													</button>
												))}
											</div>
										)}
									</div>
								) : treeQuery.isLoading ? (
									<p className="px-2 py-3 text-xs text-muted-foreground">Loading...</p>
								) : treeWorkspaces.length === 0 ? (
									<p className="px-2 py-3 text-xs text-muted-foreground">No memories yet.</p>
								) : (
									<>
										{/* General (no project) as a top-level node */}
										{treeProjects
											.filter((p) => p.project === "__general__")
											.map((project) => (
												<ProjectNode
													key={project.project}
													project={project}
													types={Object.entries(project.types).sort(([a], [b]) =>
														a.localeCompare(b),
													)}
													selection={selection}
													onSelectType={handleSelectType}
													onSelectMemory={handleSelectMemory}
													memories={
														selection.project === project.project && selection.type
															? allMemories
															: []
													}
												/>
											))}
										{/* Workspace groups */}
										{treeWorkspaces.map((ws) => (
											<WorkspaceNode
												key={ws.workspace}
												workspace={ws}
												selection={selection}
												onSelectType={handleSelectType}
												onSelectMemory={handleSelectMemory}
												memories={allMemories}
											/>
										))}
									</>
								)}
							</div>
						</div>
					)}

					{/* Toggle tree button (collapsed state) */}
					{!treePanelOpen && (
						<button
							type="button"
							className="flex w-8 shrink-0 items-center justify-center border-r hover:bg-accent/30"
							onClick={() => setTreePanelOpen(true)}
							title="Show tree"
						>
							<ChevronRight className="h-4 w-4 text-muted-foreground" />
						</button>
					)}

					{/* Content area */}
					<div className="flex flex-1 flex-col overflow-hidden">
						{/* Toolbar */}
						<div className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
							{treePanelOpen && (
								<button
									type="button"
									className="rounded-md p-1 hover:bg-accent/50"
									onClick={() => setTreePanelOpen(false)}
									title="Hide tree"
								>
									<ChevronDown className="h-4 w-4 rotate-90 text-muted-foreground" />
								</button>
							)}
							<span className="text-sm font-medium truncate">{currentTitle}</span>
						</div>

						{/* Content */}
						<div className="flex flex-1 overflow-hidden">
							{selectedMemory ? (
								<>
									{/* Memory list (middle panel, shown when a type is selected) */}
									{displayMemories.length > 1 && (
										<div className="w-72 shrink-0 border-r overflow-hidden">
											<MemoryListView
												memories={displayMemories}
												title={currentTitle}
												selection={selection}
												onSelectMemory={handleSelectMemory}
											/>
										</div>
									)}

									{/* Memory detail (right panel) */}
									<div className="flex-1 overflow-hidden">
										<MemoryContentView
											memory={selectedMemory}
											onDelete={(id) => deleteMutation.mutate(id)}
											onRestore={(id) => restoreMutation.mutate(id)}
										/>
									</div>
								</>
							) : displayMemories.length > 0 ? (
								<MemoryListView
									memories={displayMemories}
									title={currentTitle}
									selection={selection}
									onSelectMemory={handleSelectMemory}
								/>
							) : (
								<div className="flex flex-1 items-center justify-center">
									<div className="text-center">
										<BookOpen className="mx-auto h-12 w-12 text-muted-foreground/30" />
										<p className="mt-4 text-sm text-muted-foreground">
											{selection.project
												? "Select a memory type to browse"
												: "Select a project from the tree to get started"}
										</p>
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export function KnowledgePage() {
	return (
		<SidebarProvider>
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:shadow-lg"
			>
				Skip to content
			</a>
			<KnowledgeBrowserInner />
		</SidebarProvider>
	);
}
