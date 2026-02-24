import { AppLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTheme } from "@/theme-context";
import { Check } from "lucide-react";

export function SettingsPage() {
	const { theme: current, setTheme, themes } = useTheme();

	return (
		<AppLayout>
			<h2 className="mb-6 text-2xl font-semibold">Settings</h2>

			<section>
				<h3 className="mb-4 text-lg font-medium">Theme</h3>
				<div className="grid gap-4 sm:grid-cols-2">
					{themes.map((t) => {
						const active = t.id === current.id;
						// Preview colors from the dark variant
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
									{/* Mini preview */}
									<div
										className="overflow-hidden rounded-md border"
										style={{
											backgroundColor: bg,
											borderColor: border,
										}}
									>
										{/* Nav bar */}
										<div
											className="flex items-center gap-3 px-3 py-2"
											style={{
												borderBottom: `1px solid ${border}`,
											}}
										>
											<span
												className="text-xs font-semibold"
												style={{
													color: fg,
													fontFamily: t.dark["font-sans"],
												}}
											>
												YAMS
											</span>
											<span
												className="rounded px-1.5 py-0.5 text-[10px]"
												style={{
													backgroundColor: accent,
													color: fg,
												}}
											>
												Dashboard
											</span>
										</div>
										{/* Content area */}
										<div className="flex gap-2 p-3">
											{/* Stat card */}
											<div
												className="flex-1 rounded px-2 py-1.5"
												style={{
													backgroundColor: card,
													border: `1px solid ${border}`,
												}}
											>
												<span className="block text-[9px]" style={{ color: muted }}>
													Memories
												</span>
												<span
													className="text-sm font-bold"
													style={{
														color: fg,
														fontFamily: t.dark["font-sans"],
													}}
												>
													16
												</span>
											</div>
											{/* Button preview */}
											<div
												className="flex-1 rounded px-2 py-1.5"
												style={{
													backgroundColor: primary,
												}}
											>
												<span
													className="block text-[9px]"
													style={{
														color: t.dark["primary-foreground"],
													}}
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
