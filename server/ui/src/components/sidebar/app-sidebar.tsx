import { useAuth } from "@/auth-context";
import { randomBackronym } from "@/husk";
import { cn } from "@/lib/utils";
import {
	Activity,
	Brain,
	Clock,
	Cpu,
	Blocks,
	FolderOpen,
	GitGraph,
	KeyRound,
	LayoutDashboard,
	LogOut,
	ServerCog,
	Settings2,
	Star,
	Users,
} from "lucide-react";
import { useMemo } from "react";
import { SidebarGroup } from "./sidebar-group";
import { SidebarItem } from "./sidebar-item";
import { useSidebar } from "./sidebar-context";

export function AppSidebar() {
	const { isAdmin, username, logout } = useAuth();
	const { isOpen, isMobile, close } = useSidebar();
	const acronym = useMemo(() => randomBackronym(), []);

	return (
		<aside
			className={cn(
				"flex h-full w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border",
				isMobile && "fixed inset-y-0 left-0 z-40 shadow-xl transition-transform duration-200",
				isMobile && !isOpen && "-translate-x-full",
				isMobile && isOpen && "translate-x-0",
				!isMobile && !isOpen && "hidden",
			)}
		>
			{/* Header */}
			<div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
				<span className="text-lg font-bold text-sidebar-primary" title={acronym}>
					HUSK
				</span>
			</div>

			{/* Navigation */}
			<nav
				className="flex-1 overflow-y-auto py-3 space-y-4"
				onClick={isMobile ? close : undefined}
			>
				<SidebarGroup label="Home">
					<SidebarItem icon={LayoutDashboard} to="/dashboard" label="Dashboard" />
				</SidebarGroup>

				<SidebarGroup label="Observability">
					<SidebarItem icon={Blocks} to="/workspaces" label="Workspaces" />
					<SidebarItem icon={FolderOpen} to="/projects" label="Projects" />
					<SidebarItem icon={Activity} to="/tracing" label="Session Tracing" />
					<SidebarItem icon={Cpu} to="/models" label="Models" />
					<SidebarItem icon={Star} to="/scores" label="Scores" disabled />
				</SidebarGroup>

				<SidebarGroup label="Knowledge">
					<SidebarItem icon={Brain} to="/memories" label="Memories" />
					<SidebarItem icon={GitGraph} to="/graph" label="Graph" />
				</SidebarGroup>

				<SidebarGroup label="User Settings">
					<SidebarItem icon={KeyRound} to="/keys" label="API Keys" />
					<SidebarItem icon={Settings2} to="/settings" label="Settings" />
					<SidebarItem icon={Clock} to="/timeline" label="Timeline" />
				</SidebarGroup>

				{isAdmin && (
					<SidebarGroup label="Admin">
						<SidebarItem icon={Users} to="/users" label="Users" />
						<SidebarItem icon={ServerCog} to="/admin-settings" label="Server Settings" disabled />
					</SidebarGroup>
				)}
			</nav>

			{/* Footer */}
			<div className="shrink-0 border-t border-sidebar-border px-3 py-3">
				<div className="flex items-center gap-2">
					<div className="flex h-7 w-7 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground">
						{username?.charAt(0).toUpperCase() ?? "?"}
					</div>
					<span className="flex-1 truncate text-sm">{username}</span>
					<button
						onClick={logout}
						className="rounded-md p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
						title="Log out"
					>
						<LogOut className="h-4 w-4" />
					</button>
				</div>
			</div>
		</aside>
	);
}
