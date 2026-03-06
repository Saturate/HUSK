import { existsSync, mkdirSync } from "node:fs";
import * as p from "@clack/prompts";
import { ensureBun } from "../lib/bun.js";
import {
	defaultConfig,
	readConfig,
	resolveConfigPath,
	writeConfig,
} from "../lib/config-writer.js";
import { isFirstRun, setupAdmin } from "../lib/credentials.js";
import {
	detectClients,
	getManualConfig,
	registerClients,
} from "../lib/mcp-register.js";
import { advancedLocalSetup } from "../commands/init.js";
import { paths } from "../lib/paths.js";
import {
	ensureServer,
	isProcessAlive,
	readPid,
	startServerDaemon,
	startServerForeground,
	waitForHealth,
} from "../lib/server.js";
import { installService, hasService, startService } from "../lib/service.js";
import { banner, isInteractive, handleCancel } from "../lib/ui.js";

export async function startCommand(opts: { foreground?: boolean }) {
	banner();

	// 1. Ensure Bun is available
	const bunPath = await ensureBun();

	// 2. Check if already running
	const existingPid = readPid();
	if (existingPid && isProcessAlive(existingPid)) {
		p.log.success(`HUSK is already running (PID ${existingPid})`);
		return;
	}

	// 3. Download/verify server
	await ensureServer(bunPath);

	// 4. Resolve config — on first run, offer simple vs advanced setup
	let configPath = resolveConfigPath();
	if (!existsSync(configPath)) {
		if (isInteractive()) {
			const setupMode = await p.select({
				message: "How do you want to set up HUSK?",
				options: [
					{
						value: "simple",
						label: "Simple (recommended)",
						hint: "sqlite-vec + transformers, sensible defaults",
					},
					{
						value: "advanced",
						label: "Advanced",
						hint: "Pick storage, embeddings, port, compression, etc.",
					},
				],
			});
			handleCancel(setupMode);

			if (setupMode === "advanced") {
				// Delegate to the full interactive wizard — it starts the server itself
				await advancedLocalSetup(bunPath);
				return;
			}
		}

		p.log.info("Generating default configuration...");
		const config = defaultConfig();
		mkdirSync(paths.data, { recursive: true });
		writeConfig(config);
		configPath = paths.config;
		p.log.success(`Config written to ${configPath}`);
	} else {
		p.log.success(`Using config: ${configPath}`);
	}

	const config = readConfig(configPath);
	const port = config?.server?.port ?? 3000;

	// 5. Start server
	if (opts.foreground) {
		p.log.info(`Starting HUSK in foreground on port ${port}...`);
		const child = startServerForeground(bunPath, configPath);

		// Wait for health before doing first-run setup
		const healthy = await waitForHealth(port);
		if (healthy) {
			await doFirstRunSetup(port, bunPath);
		}

		// Forward signals for clean shutdown
		const shutdown = () => {
			child.kill("SIGTERM");
		};
		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);

		await new Promise<void>((resolve) => {
			child.on("exit", () => resolve());
		});
		return;
	}

	// Daemon mode
	if (hasService()) {
		p.log.info("Starting via OS service...");
		startService();
	} else {
		p.log.info(`Starting HUSK daemon on port ${port}...`);
		const pid = startServerDaemon(bunPath, configPath);
		if (pid < 0) {
			p.log.error("Failed to start server");
			process.exit(1);
		}
		p.log.info(`Daemon started (PID ${pid})`);
	}

	// 6. Wait for health
	const s = p.spinner();
	s.start("Waiting for server to be ready...");
	const healthy = await waitForHealth(port);
	if (!healthy) {
		s.stop("Server failed to start");
		p.log.error(`Server did not become healthy within 30s. Check ${paths.log}`);
		process.exit(1);
	}
	s.stop("Server is ready");

	// 7. First-run admin setup
	await doFirstRunSetup(port, bunPath);

	// 8. Summary
	p.log.success(`HUSK is running on http://localhost:${port}`);
	p.log.info(`Dashboard: http://localhost:${port}`);
	p.log.info(`Logs: ${paths.log}`);
	p.log.info('Stop with: npx husk stop');

	p.outro("HUSK is running in the background.");
	process.exit(0);
}

async function doFirstRunSetup(port: number, bunPath: string) {
	const baseUrl = `http://localhost:${port}`;

	const firstRun = await isFirstRun(baseUrl);
	if (!firstRun) return;

	p.log.info("First run detected — setting up admin account...");

	try {
		const creds = await setupAdmin(baseUrl);
		p.log.success(`Admin user created: ${creds.username}`);
		p.log.success(`API key: ${creds.apiKey}`);

		// Auto-register MCP clients
		const detected = detectClients();
		const clients = Object.entries(detected)
			.filter(([, v]) => v)
			.map(([k]) => k);

		if (clients.length > 0) {
			const registered = await registerClients(
				baseUrl,
				creds.apiKey,
				clients,
			);
			for (const name of registered) {
				p.log.success(`Registered with ${name}`);
			}
		} else {
			p.log.info("No MCP clients detected. Manual config:");
			console.log(getManualConfig(baseUrl, creds.apiKey));
		}

		// Offer to install OS service if not already installed
		if (!hasService() && isInteractive()) {
			const install = await p.confirm({
				message: "Install as OS service? (auto-start on boot, restart on crash)",
			});
			if (install && !p.isCancel(install)) {
				installService(bunPath, paths.config);
			}
		}
	} catch (err) {
		p.log.error(
			`Admin setup failed: ${err instanceof Error ? err.message : err}`,
		);
	}
}
