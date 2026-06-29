import { AppSidebar, SidebarProvider, useSidebar } from "@/components/sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Menu } from "lucide-react";
import type { ReactNode } from "react";

export function AuthLayout({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-svh items-center justify-center p-4">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle className="text-xl">{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</CardHeader>
				<CardContent>{children}</CardContent>
			</Card>
		</div>
	);
}

function AppLayoutInner({ children }: { children: ReactNode }) {
	const { isOpen, isMobile, toggle, close } = useSidebar();

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
					<span className="text-sm font-semibold">HUSK</span>
				</header>

				<main id="main-content" className={cn("flex-1 overflow-y-auto p-6")}>
					<div className="mx-auto max-w-6xl">{children}</div>
				</main>
			</div>
		</div>
	);
}

export function AppLayout({ children }: { children: ReactNode }) {
	return (
		<SidebarProvider>
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:shadow-lg"
			>
				Skip to content
			</a>
			<AppLayoutInner>{children}</AppLayoutInner>
		</SidebarProvider>
	);
}
