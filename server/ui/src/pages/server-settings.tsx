import { api } from "@/api";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function ServerSettingsPage() {
	return (
		<AppLayout>
			<h2 className="mb-6 text-2xl font-semibold">Server Settings</h2>
			<CompressionSettings />
			<RetentionSettings />
			<PrivacySettings />
		</AppLayout>
	);
}

function CompressionSettings() {
	const queryClient = useQueryClient();
	const settingsQuery = useQuery({
		queryKey: ["settings"],
		queryFn: () => api.getSettings(),
	});

	const updateMutation = useMutation({
		mutationFn: (settings: Record<string, string | null>) => api.updateSettings(settings),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
	});

	const settings = settingsQuery.data?.settings ?? {};

	const [compressionApiKey, setCompressionApiKey] = useState("");
	const [compressionBaseUrl, setCompressionBaseUrl] = useState("");
	const [compressionModel, setCompressionModel] = useState("");
	const [batchSize, setBatchSize] = useState("");
	const [intervalMinutes, setIntervalMinutes] = useState("");

	function handleUpdate(key: string, value: string) {
		updateMutation.mutate({ [key]: value });
	}

	return (
		<section>
			<h3 className="mb-4 text-lg font-medium">Compression</h3>
			<Card>
				<CardContent className="space-y-4 pt-6">
					<div className="space-y-1">
						<Label htmlFor="compression-mode">Mode</Label>
						<Select
							value={settings.compression_mode ?? "client"}
							onValueChange={(v) => handleUpdate("compression_mode", v)}
						>
							<SelectTrigger id="compression-mode" className="w-48">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="client">Client-side</SelectItem>
								<SelectItem value="server">Server-side</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							Server-side compression uses an LLM to summarize sessions and extract knowledge
							automatically.
						</p>
					</div>

					{(settings.compression_mode ?? "client") === "server" && (
						<>
							<div className="space-y-1">
								<Label htmlFor="compression-provider">LLM Provider</Label>
								<Select
									value={settings.compression_provider ?? "anthropic"}
									onValueChange={(v) => handleUpdate("compression_provider", v)}
								>
									<SelectTrigger id="compression-provider" className="w-64">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="anthropic">Anthropic (direct API)</SelectItem>
										<SelectItem value="openrouter">
											OpenAI-compatible (OpenRouter, vLLM, etc.)
										</SelectItem>
										<SelectItem value="ollama">Ollama</SelectItem>
									</SelectContent>
								</Select>
							</div>

							{(settings.compression_provider ?? "anthropic") !== "anthropic" && (
								<div className="space-y-1">
									<Label htmlFor="compression-base-url">Endpoint URL</Label>
									<div className="flex gap-2">
										<Input
											id="compression-base-url"
											className="w-72"
											placeholder={
												(settings.compression_provider ?? "anthropic") === "ollama"
													? "http://localhost:11434"
													: "https://openrouter.ai/api/v1"
											}
											value={compressionBaseUrl || settings.compression_base_url || ""}
											onChange={(e) => setCompressionBaseUrl(e.target.value)}
										/>
										<Button
											size="sm"
											variant="outline"
											disabled={!compressionBaseUrl.trim()}
											onClick={() => {
												handleUpdate("compression_base_url", compressionBaseUrl.trim());
												setCompressionBaseUrl("");
											}}
										>
											Save
										</Button>
									</div>
								</div>
							)}

							<div className="space-y-1">
								<Label htmlFor="compression-model">Model</Label>
								<div className="flex gap-2">
									<Input
										id="compression-model"
										className="w-72"
										placeholder={settings.compression_model ?? "claude-haiku-4-5-20251001"}
										value={compressionModel}
										onChange={(e) => setCompressionModel(e.target.value)}
									/>
									<Button
										size="sm"
										variant="outline"
										disabled={!compressionModel.trim()}
										onClick={() => {
											handleUpdate("compression_model", compressionModel.trim());
											setCompressionModel("");
										}}
									>
										Save
									</Button>
								</div>
							</div>

							{(settings.compression_provider ?? "anthropic") !== "ollama" && (
								<div className="space-y-1">
									<Label htmlFor="compression-api-key">API Key</Label>
									<div className="flex gap-2">
										<Input
											id="compression-api-key"
											type="password"
											className="w-72"
											placeholder={settings.compression_api_key ? "****" : "Not set"}
											value={compressionApiKey}
											onChange={(e) => setCompressionApiKey(e.target.value)}
										/>
										<Button
											size="sm"
											variant="outline"
											disabled={!compressionApiKey.trim()}
											onClick={() => {
												handleUpdate("compression_api_key", compressionApiKey.trim());
												setCompressionApiKey("");
											}}
										>
											Save
										</Button>
									</div>
								</div>
							)}

							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-1">
									<Label htmlFor="batch-size">Batch size (observations)</Label>
									<div className="flex gap-2">
										<Input
											id="batch-size"
											className="w-24"
											placeholder={settings.compression_batch_size ?? "20"}
											value={batchSize}
											onChange={(e) => setBatchSize(e.target.value)}
										/>
										<Button
											size="sm"
											variant="outline"
											disabled={!batchSize.trim()}
											onClick={() => {
												handleUpdate("compression_batch_size", batchSize.trim());
												setBatchSize("");
											}}
										>
											Save
										</Button>
									</div>
								</div>
								<div className="space-y-1">
									<Label htmlFor="interval">Stale interval (minutes)</Label>
									<div className="flex gap-2">
										<Input
											id="interval"
											className="w-24"
											placeholder={settings.compression_interval_minutes ?? "15"}
											value={intervalMinutes}
											onChange={(e) => setIntervalMinutes(e.target.value)}
										/>
										<Button
											size="sm"
											variant="outline"
											disabled={!intervalMinutes.trim()}
											onClick={() => {
												handleUpdate("compression_interval_minutes", intervalMinutes.trim());
												setIntervalMinutes("");
											}}
										>
											Save
										</Button>
									</div>
								</div>
							</div>
						</>
					)}
				</CardContent>
			</Card>
		</section>
	);
}

function RetentionSettings() {
	const queryClient = useQueryClient();
	const settingsQuery = useQuery({
		queryKey: ["settings"],
		queryFn: () => api.getSettings(),
	});

	const updateMutation = useMutation({
		mutationFn: (settings: Record<string, string | null>) => api.updateSettings(settings),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
	});

	const settings = settingsQuery.data?.settings ?? {};

	const ttlFields = [
		{
			key: "ttl_default_session",
			label: "Session TTL",
			desc: "Default TTL for session-scoped memories",
		},
		{
			key: "ttl_default_project",
			label: "Project TTL",
			desc: "Default TTL for project-scoped memories",
		},
		{
			key: "ttl_default_workspace",
			label: "Workspace TTL",
			desc: "Default TTL for workspace-scoped memories",
		},
		{
			key: "ttl_default_global",
			label: "Global TTL",
			desc: "Default TTL for global-scoped memories",
		},
		{ key: "ttl_max", label: "Max TTL", desc: "Maximum TTL any memory can have" },
	];

	return (
		<section className="mt-8">
			<h3 className="mb-4 text-lg font-medium">Retention</h3>
			<Card>
				<CardContent className="space-y-4 pt-6">
					<div className="space-y-1">
						<Label htmlFor="dedup-threshold">Dedup threshold</Label>
						<DedupInput
							current={settings.dedup_threshold ?? "0.95"}
							onSave={(v) => updateMutation.mutate({ dedup_threshold: v })}
						/>
						<p className="text-xs text-muted-foreground">
							Vector similarity threshold (0.5-1.0). Higher = stricter dedup.
						</p>
					</div>

					<div className="space-y-1">
						<Label htmlFor="session-context">Session context count</Label>
						<DedupInput
							current={settings.session_context_count ?? "5"}
							onSave={(v) => updateMutation.mutate({ session_context_count: v })}
						/>
						<p className="text-xs text-muted-foreground">
							Number of recent session summaries to include in context (1-20).
						</p>
					</div>

					<div className="space-y-3">
						<Label>Memory TTLs (seconds)</Label>
						<div className="grid grid-cols-2 gap-3">
							{ttlFields.map((f) => (
								<div key={f.key} className="space-y-1">
									<span className="text-xs text-muted-foreground">{f.label}</span>
									<DedupInput
										current={settings[f.key] ?? ""}
										onSave={(v) => updateMutation.mutate({ [f.key]: v || null })}
										placeholder="Not set"
									/>
								</div>
							))}
						</div>
					</div>
				</CardContent>
			</Card>
		</section>
	);
}

function DedupInput({
	current,
	onSave,
	placeholder,
}: { current: string; onSave: (v: string) => void; placeholder?: string }) {
	const [value, setValue] = useState("");
	return (
		<div className="flex gap-2">
			<Input
				className="w-28"
				placeholder={placeholder ?? current}
				value={value}
				onChange={(e) => setValue(e.target.value)}
			/>
			<Button
				size="sm"
				variant="outline"
				disabled={!value.trim()}
				onClick={() => {
					onSave(value.trim());
					setValue("");
				}}
			>
				Save
			</Button>
		</div>
	);
}

function PrivacySettings() {
	const queryClient = useQueryClient();
	const settingsQuery = useQuery({
		queryKey: ["settings"],
		queryFn: () => api.getSettings(),
	});

	const updateMutation = useMutation({
		mutationFn: (settings: Record<string, string | null>) => api.updateSettings(settings),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
	});

	const settings = settingsQuery.data?.settings ?? {};
	const [patterns, setPatterns] = useState("");

	return (
		<section className="mt-8">
			<h3 className="mb-4 text-lg font-medium">Privacy</h3>
			<Card>
				<CardContent className="space-y-4 pt-6">
					<div className="space-y-1">
						<Label htmlFor="privacy-patterns">Redaction patterns</Label>
						<textarea
							id="privacy-patterns"
							className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							rows={4}
							placeholder={
								settings.privacy_patterns || "# One regex per line\n# e.g. \\b[A-Z0-9]{20}\\b"
							}
							value={patterns}
							onChange={(e) => setPatterns(e.target.value)}
						/>
						<div className="flex items-center gap-2">
							<Button
								size="sm"
								variant="outline"
								disabled={!patterns.trim()}
								onClick={() => {
									updateMutation.mutate({ privacy_patterns: patterns.trim() });
									setPatterns("");
								}}
							>
								Save
							</Button>
							<p className="text-xs text-muted-foreground">
								Regex patterns to redact from stored content. One pattern per line.
							</p>
						</div>
					</div>
				</CardContent>
			</Card>
		</section>
	);
}
