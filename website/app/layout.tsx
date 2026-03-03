import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";

export const metadata = {
	title: "HUSK — Helpful Universal Storage for Knowledge",
	description:
		"Self-hosted memory layer for AI coding assistants. Captures what you work on, remembers cross-project patterns, and surfaces relevant context.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body>
				<RootProvider>{children}</RootProvider>
			</body>
		</html>
	);
}
