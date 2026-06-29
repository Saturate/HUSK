import { type ApiKey, api } from "@/api";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTheme } from "@/theme-context";
import { useQuery } from "@tanstack/react-query";
import { Check, ClipboardCopy } from "lucide-react";
import { useState } from "react";

export function SettingsPage() {
	const { theme: current, setTheme, themes } = useTheme();

	return (
		<AppLayout>
			<h2 className="mb-6 text-2xl font-semibold">Settings</h2>

			<HooksConfigSection />

			<section className="mt-8">
				<h3 className="mb-4 text-lg font-medium">Theme</h3>
				<div className="grid gap-4 sm:grid-cols-2">
					{themes.map((t) => {
						const active = t.id === current.id;
						const bg = t.dark.background;
						const card = t.dark.card;
						const fg = t.dark.foreground;
						const muted = t.dark["muted-foreground"];
						const primary = t.dark.primary;
						const border = t.dark.border;
						const accent = t.dark.accent;

						return (
							<Card
								key={t.id}
								tabIndex={0}
								onClick={() => setTheme(t.id)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										setTheme(t.id);
									}
								}}
								className={cn(
									"relative cursor-pointer transition-shadow hover:shadow-lg",
									active && "ring-2 ring-ring",
								)}
							>
								<CardHeader className="pb-2">
									<CardTitle className="flex items-center gap-2 text-base">
										{t.name}
										{active && <Check className="h-4 w-4 text-primary" />}
									</CardTitle>
									<p className="text-sm text-muted-foreground">{t.description}</p>
								</CardHeader>
								<CardContent>
									<div
										className="overflow-hidden rounded-md border"
										style={{ backgroundColor: bg, borderColor: border }}
									>
										<div
											className="flex items-center gap-3 px-3 py-2"
											style={{ borderBottom: `1px solid ${border}` }}
										>
											<span
												className="text-xs font-semibold"
												style={{ color: fg, fontFamily: t.dark["font-sans"] }}
											>
												HUSK
											</span>
											<span
												className="rounded px-1.5 py-0.5 text-[10px]"
												style={{ backgroundColor: accent, color: fg }}
											>
												Dashboard
											</span>
										</div>
										<div className="flex gap-2 p-3">
											<div
												className="flex-1 rounded px-2 py-1.5"
												style={{ backgroundColor: card, border: `1px solid ${border}` }}
											>
												<span className="block text-[9px]" style={{ color: muted }}>
													Memories
												</span>
												<span
													className="text-sm font-bold"
													style={{ color: fg, fontFamily: t.dark["font-sans"] }}
												>
													16
												</span>
											</div>
											<div
												className="flex-1 rounded px-2 py-1.5"
												style={{ backgroundColor: primary }}
											>
												<span
													className="block text-[9px]"
													style={{ color: t.dark["primary-foreground"] }}
												>
													Primary
												</span>
											</div>
										</div>
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			</section>
		</AppLayout>
	);
}

function HooksConfigSection() {
	const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

	const keysQuery = useQuery({
		queryKey: ["keys"],
		queryFn: () => api.listKeys(),
	});

	const activeKeys = (keysQuery.data ?? []).filter((k) => k.is_active);

	async function copyHooksConfig(key: ApiKey) {
		try {
			const config = await api.getHooksConfig(key.id);
			await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
			setCopiedKeyId(key.id);
			setTimeout(() => setCopiedKeyId(null), 2000);
		} catch {
			// clipboard may not be available
		}
	}

	return (
		<section className="mt-8">
			<h3 className="mb-4 text-lg font-medium">Hooks Configuration</h3>
			<p className="mb-4 text-sm text-muted-foreground">
				Copy the hooks config for an API key and paste it into your{" "}
				<code className="rounded bg-muted px-1 py-0.5 text-xs">.claude/settings.json</code>. Set the{" "}
				<code className="rounded bg-muted px-1 py-0.5 text-xs">HUSK_API_KEY</code> environment
				variable to your raw API key.
			</p>
			{keysQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">Loading keys...</p>
			) : activeKeys.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No active API keys. Create one on the API Keys page first.
				</p>
			) : (
				<div className="space-y-2">
					{activeKeys.map((k) => (
						<Card key={k.id}>
							<CardContent className="flex items-center justify-between py-3">
								<div>
									<span className="font-medium">{k.label}</span>
									<span className="ml-2 text-sm text-muted-foreground">({k.key_prefix}...)</span>
								</div>
								<Button size="sm" variant="outline" onClick={() => copyHooksConfig(k)}>
									{copiedKeyId === k.id ? (
										<>
											<Check className="mr-1 h-3 w-3" /> Copied
										</>
									) : (
										<>
											<ClipboardCopy className="mr-1 h-3 w-3" /> Copy hooks config
										</>
									)}
								</Button>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</section>
	);
}
