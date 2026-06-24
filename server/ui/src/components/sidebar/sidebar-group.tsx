import type { ReactNode } from "react";

interface SidebarGroupProps {
	label: string;
	children: ReactNode;
	className?: string;
}

export function SidebarGroup({ label, children, className }: SidebarGroupProps) {
	return (
		<div className={className}>
			<div className="px-3 py-2 text-[11px] uppercase tracking-wider text-sidebar-foreground/50">
				{label}
			</div>
			<div className="space-y-0.5 px-2">{children}</div>
		</div>
	);
}
