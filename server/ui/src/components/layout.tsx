import { useAuth } from "@/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export function AppLayout({ children }: { children: ReactNode }) {
	const { logout } = useAuth();

	return (
		<div className="min-h-svh">
			<header className="border-b">
				<div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
					<h1 className="text-lg font-semibold">YAMS</h1>
					<Button variant="ghost" size="sm" onClick={logout}>
						Log out
					</Button>
				</div>
			</header>
			<main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
		</div>
	);
}
