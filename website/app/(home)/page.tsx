import Link from "next/link";
import { NeuronBackground } from "@/components/neuron-bg";

export default function HomePage() {
	return (
		<main className="relative flex min-h-[calc(100vh-64px)] flex-col items-center justify-center overflow-hidden px-4">
			<NeuronBackground />

			<div className="pointer-events-none relative z-10 mx-auto max-w-2xl text-center">
				<h1 className="mb-4 text-5xl font-bold tracking-tight sm:text-6xl">
					🍠 YAMS
				</h1>
				<p className="mb-2 text-lg text-fd-muted-foreground sm:text-xl">
					Your AI Memory System
				</p>
				<p className="mx-auto mb-8 max-w-lg text-fd-muted-foreground">
					Self-hosted memory layer for AI coding assistants. Captures what you
					work on, remembers cross-project patterns, and surfaces relevant
					context — across all your machines and tools.
				</p>

				<div className="pointer-events-auto flex flex-wrap items-center justify-center gap-3">
					<Link
						href="/docs"
						className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
					>
						Get Started
					</Link>
					<a
						href="https://github.com/Saturate/YAMS"
						target="_blank"
						rel="noopener noreferrer"
						className="rounded-lg border border-fd-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent"
					>
						GitHub
					</a>
				</div>

				<div className="mt-10">
					<div className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card/50 px-4 py-2.5 font-mono text-sm backdrop-blur-sm">
						<span className="text-fd-muted-foreground select-none">$</span>
						<span className="text-fd-muted-foreground/60">npx yams</span>
						<span className="ml-2 rounded bg-fd-muted px-1.5 py-0.5 text-xs text-fd-muted-foreground">
							coming soon
						</span>
					</div>
				</div>
			</div>
		</main>
	);
}
