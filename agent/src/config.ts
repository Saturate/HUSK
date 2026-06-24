import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface AgentConfig {
	serverUrl: string | null;
	apiKey: string | null;
}

let cached: AgentConfig | null = null;

export function loadConfig(): AgentConfig {
	if (cached) return cached;

	let url = process.env.HUSK_URL ?? null;
	let key = process.env.HUSK_KEY ?? null;

	if (!url || !key) {
		const credPath = join(homedir(), ".husk", "credentials.json");
		if (existsSync(credPath)) {
			try {
				const creds = JSON.parse(readFileSync(credPath, "utf-8")) as {
					url?: string;
					apiKey?: string;
				};
				url = url ?? creds.url ?? null;
				key = key ?? creds.apiKey ?? null;
			} catch {
				// Invalid credentials file
			}
		}
	}

	cached = { serverUrl: url, apiKey: key };
	return cached;
}

export function deriveProject(cwd: string | null): string | null {
	if (!cwd) return null;
	try {
		const result = Bun.spawnSync(["git", "remote", "get-url", "origin"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) return null;
		const url = result.stdout.toString().trim();
		// Extract owner/repo from git URL
		return url
			.replace(/.*github\.com[:/]/, "")
			.replace(/.*dev\.azure\.com\//, "")
			.replace(/\.git$/, "");
	} catch {
		return cwd.split("/").pop() ?? null;
	}
}

export function deriveGitBranch(cwd: string | null): string | null {
	if (!cwd) return null;
	try {
		const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		return result.exitCode === 0 ? result.stdout.toString().trim() : null;
	} catch {
		return null;
	}
}
