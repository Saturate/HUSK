import * as p from "@clack/prompts";
import { readConfig, resolveConfigPath } from "../lib/config-writer.js";
import { isProcessAlive, readPid } from "../lib/server.js";
import { hasService } from "../lib/service.js";
import { banner } from "../lib/ui.js";

export async function statusCommand() {
	banner();

	const pid = readPid();
	const alive = pid ? isProcessAlive(pid) : false;
	const configPath = resolveConfigPath();
	const config = readConfig(configPath);
	const port = config?.server?.port ?? 3000;

	const rows: string[] = [];

	if (alive && pid) {
		rows.push(`Status:     running`);
		rows.push(`PID:        ${pid}`);
	} else {
		rows.push(`Status:     stopped`);
	}

	rows.push(`Port:       ${port}`);
	rows.push(`Config:     ${configPath}`);
	rows.push(`OS Service: ${hasService() ? "installed" : "not installed"}`);

	if (config?.storage?.backend) {
		rows.push(`Storage:    ${config.storage.backend}`);
	}
	if (config?.embeddings?.backend) {
		rows.push(`Embeddings: ${config.embeddings.backend}`);
	}

	// Try health check if running
	if (alive) {
		try {
			const res = await fetch(`http://localhost:${port}/health`);
			if (res.ok) {
				const health = (await res.json()) as {
					status: string;
					checks: Record<string, string>;
				};
				rows.push(`Health:     ${health.status}`);
				for (const [check, status] of Object.entries(health.checks)) {
					rows.push(`  ${check}: ${status}`);
				}
			}
		} catch {
			rows.push(`Health:     unreachable`);
		}
	}

	p.note(rows.join("\n"), "HUSK Status");
	p.outro("");
}
