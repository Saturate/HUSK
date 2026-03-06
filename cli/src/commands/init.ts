import { existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import { ensureBun } from "../lib/bun.js";
import {
	type HuskConfig,
	writeConfig,
	defaultConfig,
} from "../lib/config-writer.js";
import { setupAdmin, type Credentials } from "../lib/credentials.js";
import {
	detectClients,
	getManualConfig,
	registerClients,
} from "../lib/mcp-register.js";
import { generateDockerCompose } from "../lib/docker.js";
import { paths } from "../lib/paths.js";
import {
	ensureServer,
	startServerDaemon,
	waitForHealth,
} from "../lib/server.js";
import { installService } from "../lib/service.js";
import { banner, handleCancel } from "../lib/ui.js";

export async function initCommand() {
	banner();

	// --- Install mode ---
	const mode = await p.select({
		message: "Where is the HUSK server?",
		options: [
			{
				value: "local",
				label: "Install locally",
				hint: "Download + run on this machine",
			},
			{
				value: "remote",
				label: "Connect to remote server",
				hint: "Already running elsewhere",
			},
		],
	});
	handleCancel(mode);

	if (mode === "remote") {
		await remoteSetup();
	} else {
		await localSetup();
	}
}

// ── Remote mode: just collect URL + key, register MCP clients ───────

async function remoteSetup() {
	const url = await p.text({
		message: "Server URL:",
		placeholder: "https://husk.example.com",
		validate: (v) => {
			if (!v.startsWith("http://") && !v.startsWith("https://"))
				return "Must start with http:// or https://";
		},
	});
	handleCancel(url);

	// Strip trailing slash
	const baseUrl = url.replace(/\/+$/, "");

	// Verify it's reachable
	const s = p.spinner();
	s.start("Checking server...");
	try {
		const res = await fetch(`${baseUrl}/health`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		s.stop("Server is reachable");
	} catch (err) {
		s.stop("Server unreachable");
		p.log.error(
			`Cannot reach ${baseUrl}/health: ${err instanceof Error ? err.message : err}`,
		);
		process.exit(1);
	}

	const apiKey = await p.text({
		message: "API key:",
		placeholder: "husk_xxx",
		validate: (v) => {
			if (!v.startsWith("husk_")) return "Must start with husk_";
		},
	});
	handleCancel(apiKey);

	// Verify the key works
	const s2 = p.spinner();
	s2.start("Verifying API key...");
	try {
		const res = await fetch(`${baseUrl}/api/keys/me`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		s2.stop("API key valid");
	} catch (err) {
		s2.stop("API key invalid");
		p.log.error(
			`Key verification failed: ${err instanceof Error ? err.message : err}`,
		);
		process.exit(1);
	}

	// MCP registration
	await registerMcpClients(baseUrl, apiKey);

	p.note(
		[
			`Server:  ${baseUrl}`,
			`API Key: ${apiKey}`,
		].join("\n"),
		"Connected to remote HUSK",
	);

	p.outro("Setup complete!");
	process.exit(0);
}

// ── Local mode: full wizard (same as before) ────────────────────────

async function localSetup() {
	const bunPath = await ensureBun();
	await ensureServer(bunPath);
	await advancedLocalSetup(bunPath);
}

/**
 * Advanced local setup wizard — picks storage, embeddings, port, compression,
 * admin, docker, starts server, registers MCP. Exported so `husk` (start.ts)
 * can offer it as an option on first run.
 */
export async function advancedLocalSetup(bunPath: string) {
	const config = defaultConfig();
	const dockerServices: { qdrant?: boolean; ollama?: { model?: string } } = {};

	// --- Storage ---
	const storage = await p.select({
		message: "Vector storage backend:",
		options: [
			{
				value: "sqlite-vec",
				label: "sqlite-vec (recommended)",
				hint: "Zero setup, embedded",
			},
			{
				value: "qdrant",
				label: "Qdrant",
				hint: "Dedicated vector database",
			},
		],
	});
	handleCancel(storage);
	config.storage = { backend: storage };

	if (storage === "qdrant") {
		const url = await p.text({
			message: "Qdrant URL:",
			initialValue: "http://localhost:6333",
		});
		handleCancel(url);
		config.storage.url = url;

		const generateDocker = await p.confirm({
			message: "Generate docker-compose.yml for Qdrant?",
		});
		handleCancel(generateDocker);
		if (generateDocker) {
			dockerServices.qdrant = true;
		}
	} else {
		config.storage.path = paths.vectorsPath;
	}

	// --- Embeddings ---
	const embeddings = await p.select({
		message: "Embedding provider:",
		options: [
			{
				value: "transformers",
				label: "Transformers (recommended)",
				hint: "Local, no API key needed",
			},
			{
				value: "ollama",
				label: "Ollama",
				hint: "Local, requires Ollama running",
			},
			{ value: "openai", label: "OpenAI", hint: "Requires API key" },
			{ value: "voyage", label: "Voyage AI", hint: "Requires API key" },
			{
				value: "llamacpp",
				label: "llama.cpp",
				hint: "Local llama.cpp server",
			},
		],
	});
	handleCancel(embeddings);
	config.embeddings = { backend: embeddings };

	if (embeddings === "ollama") {
		const url = await p.text({
			message: "Ollama URL:",
			initialValue: "http://localhost:11434",
		});
		handleCancel(url);
		config.embeddings.url = url;

		const model = await p.text({
			message: "Ollama embedding model:",
			initialValue: "nomic-embed-text",
		});
		handleCancel(model);
		config.embeddings.model = model;

		const generateDocker = await p.confirm({
			message: "Add Ollama to docker-compose.yml?",
		});
		handleCancel(generateDocker);
		if (generateDocker) {
			dockerServices.ollama = { model };
		}
	} else if (embeddings === "openai" || embeddings === "voyage") {
		const apiKey = await p.password({
			message: `${embeddings === "openai" ? "OpenAI" : "Voyage"} API key:`,
		});
		handleCancel(apiKey);
		config.embeddings.api_key = apiKey;

		const model = await p.text({
			message: "Model name:",
			initialValue:
				embeddings === "openai"
					? "text-embedding-3-small"
					: "voyage-3-lite",
		});
		handleCancel(model);
		config.embeddings.model = model;
	} else if (embeddings === "llamacpp") {
		const url = await p.text({
			message: "llama.cpp server URL:",
			initialValue: "http://localhost:8080",
		});
		handleCancel(url);
		config.embeddings.url = url;
	} else {
		config.embeddings.models_path = paths.modelsPath;
	}

	// --- Server ---
	const port = await p.text({
		message: "Server port:",
		initialValue: "3000",
		validate: (v) => {
			const n = parseInt(v, 10);
			if (Number.isNaN(n) || n < 1 || n > 65535)
				return "Must be a valid port (1-65535)";
		},
	});
	handleCancel(port);
	config.server = {
		port: parseInt(port, 10),
		db_path: paths.dbPath,
	};

	const dataDir = await p.text({
		message: "Data directory:",
		initialValue: paths.data,
	});
	handleCancel(dataDir);
	config.server.db_path = `${dataDir}/husk.db`;
	if (config.storage?.backend === "sqlite-vec") {
		config.storage.path = `${dataDir}/husk-vectors.db`;
	}
	if (config.embeddings?.backend === "transformers") {
		config.embeddings.models_path = `${dataDir}/models`;
	}

	// --- Compression (optional) ---
	const enableCompression = await p.confirm({
		message: "Enable memory compression?",
		initialValue: false,
	});
	handleCancel(enableCompression);

	if (enableCompression) {
		const provider = await p.select({
			message: "Compression provider:",
			options: [
				{ value: "anthropic", label: "Anthropic" },
				{ value: "openrouter", label: "OpenRouter" },
				{ value: "ollama", label: "Ollama" },
			],
		});
		handleCancel(provider);

		config.compression = { provider };

		if (provider === "anthropic" || provider === "openrouter") {
			const apiKey = await p.password({
				message: `${provider === "anthropic" ? "Anthropic" : "OpenRouter"} API key:`,
			});
			handleCancel(apiKey);
			config.compression.api_key = apiKey;
		}

		const model = await p.text({
			message: "Compression model:",
			initialValue:
				provider === "anthropic"
					? "claude-sonnet-4-20250514"
					: provider === "ollama"
						? "llama3.2"
						: "anthropic/claude-sonnet-4-20250514",
		});
		handleCancel(model);
		config.compression.model = model;
	}

	// --- Admin account ---
	const username = await p.text({
		message: "Admin username:",
		initialValue: "admin",
		validate: (v) => {
			if (v.length < 3) return "Must be at least 3 characters";
		},
	});
	handleCancel(username);

	const password = await p.password({
		message: "Admin password (min 8 chars):",
		validate: (v) => {
			if (v.length < 8) return "Must be at least 8 characters";
		},
	});
	handleCancel(password);

	// --- Write config ---
	mkdirSync(dataDir, { recursive: true });
	writeConfig(config);
	p.log.success(`Config written to ${paths.config}`);

	// --- Docker compose ---
	if (dockerServices.qdrant || dockerServices.ollama) {
		const composePath = generateDockerCompose(dockerServices, process.cwd());
		p.log.success(`Docker Compose written to ${composePath}`);

		const startDocker = await p.confirm({
			message: "Start Docker services now?",
		});
		handleCancel(startDocker);

		if (startDocker) {
			try {
				p.log.info("Starting Docker services...");
				execSync("docker compose up -d", {
					cwd: process.cwd(),
					stdio: "inherit",
				});
			} catch {
				p.log.warning(
					"Failed to start Docker services. Start them manually with: docker compose up -d",
				);
			}
		}
	}

	// --- Start server ---
	p.log.info("Starting HUSK server...");
	const serverPort = config.server?.port ?? 3000;
	const pid = startServerDaemon(bunPath, paths.config);
	if (pid < 0) {
		p.log.error("Failed to start server");
		process.exit(1);
	}

	const s = p.spinner();
	s.start("Waiting for server...");
	const healthy = await waitForHealth(serverPort);
	if (!healthy) {
		s.stop("Server failed to start");
		p.log.error(`Server did not start. Check ${paths.log}`);
		process.exit(1);
	}
	s.stop("Server is ready");

	// --- Admin setup ---
	const baseUrl = `http://localhost:${serverPort}`;
	const creds = await setupAdmin(baseUrl, username, password);
	p.log.success(`Admin created: ${creds.username}`);
	p.log.success(`API key: ${creds.apiKey}`);

	// --- Install OS service ---
	installService(bunPath, paths.config);

	// --- MCP registration ---
	await registerMcpClients(baseUrl, creds.apiKey);

	// --- Summary ---
	console.log();
	p.note(
		[
			`Server:    ${baseUrl}`,
			`API Key:   ${creds.apiKey}`,
			`Dashboard: ${baseUrl}`,
			`Config:    ${paths.config}`,
			`Logs:      ${paths.log}`,
			``,
			`Stop:      npx husk stop`,
		].join("\n"),
		"HUSK is running",
	);

	p.outro("Setup complete!");
	process.exit(0);
}

// ── Shared: MCP client registration prompt ──────────────────────────

async function registerMcpClients(serverUrl: string, apiKey: string) {
	const detected = detectClients();
	const mcpOptions: { value: string; label: string }[] = [];
	if (detected.claude) mcpOptions.push({ value: "claude", label: "Claude Code" });
	if (detected.cursor) mcpOptions.push({ value: "cursor", label: "Cursor" });
	mcpOptions.push({ value: "manual", label: "Show manual config" });

	const mcpChoices = await p.multiselect({
		message: "Register MCP with:",
		options: mcpOptions,
		required: false,
	});
	handleCancel(mcpChoices);

	const clientsToRegister = mcpChoices.filter(
		(c): c is string => c !== "manual",
	);
	if (clientsToRegister.length > 0) {
		const registered = await registerClients(
			serverUrl,
			apiKey,
			clientsToRegister,
		);
		for (const name of registered) {
			p.log.success(`Registered with ${name}`);
		}
	}
	if (mcpChoices.includes("manual")) {
		console.log(getManualConfig(serverUrl, apiKey));
	}
}
