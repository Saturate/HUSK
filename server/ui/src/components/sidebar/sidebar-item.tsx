import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Link, useLocation } from "react-router";

interface SidebarItemProps {
	icon: LucideIcon;
	to: string;
	label: string;
	disabled?: boolean;
}

export function SidebarItem({ icon: Icon, to, label, disabled }: SidebarItemProps) {
	const { pathname } = useLocation();
	const isActive = pathname === to || pathname.startsWith(`${to}/`);

	if (disabled) {
		return (
			<div className="flex items-center gap-3 rounded-md px-3 py-1.5 text-sm opacity-40 cursor-default">
				<Icon className="h-4 w-4 shrink-0" />
				<span>{label}</span>
				<span className="ml-auto rounded bg-sidebar-accent/50 px-1.5 py-0.5 text-[10px] leading-none">
					soon
				</span>
			</div>
		);
	}

	return (
		<Link
			to={to}
			className={cn(
				"flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors",
				"hover:bg-sidebar-accent/50",
				isActive && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
			)}
		>
			<Icon className="h-4 w-4 shrink-0" />
			<span>{label}</span>
		</Link>
	);
}
