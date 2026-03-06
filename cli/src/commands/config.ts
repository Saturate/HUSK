import * as p from "@clack/prompts";
import {
	type HuskConfig,
	readConfig,
	resolveConfigPath,
	writeConfig,
} from "../lib/config-writer.js";
import { paths } from "../lib/paths.js";
import { isProcessAlive, readPid } from "../lib/server.js";
import { banner, handleCancel } from "../lib/ui.js";

export async function configCommand() {
	banner();

	const configPath = resolveConfigPath();
	const config = readConfig(configPath);

	if (!config) {
		p.log.error(
			`No config found at ${configPath}. Run \`npx husk init\` first.`,
		);
		process.exit(1);
	}

	p.log.info(`Config: ${configPath}`);
	console.log();

	displayConfig(config);

	while (true) {
		const section = await p.select({
			message: "Edit section:",
			options: [
				{ value: "storage", label: "Storage" },
				{ value: "embeddings", label: "Embeddings" },
				{ value: "server", label: "Server" },
				{ value: "compression", label: "Compression" },
				{ value: "exit", label: "Exit" },
			],
		});
		handleCancel(section);

		if (section === "exit") break;

		await editSection(config, section as keyof HuskConfig);
		writeConfig(config, configPath);
		p.log.success("Config saved");

		const pid = readPid();
		if (pid && isProcessAlive(pid)) {
			const restart = await p.confirm({
				message: "Server is running. Restart to apply changes?",
			});
			handleCancel(restart);
			if (restart) {
				p.log.info(
					"Restart the server with: npx husk stop && npx husk",
				);
			}
		}
	}

	p.outro("Done");
}

function displayConfig(config: HuskConfig) {
	const rows: string[] = [];

	if (config.server) {
		rows.push(`[server]`);
		if (config.server.port) rows.push(`  port = ${config.server.port}`);
		if (config.server.db_path) rows.push(`  db_path = ${config.server.db_path}`);
	}

	if (config.storage) {
		rows.push(`[storage]`);
		if (config.storage.backend) rows.push(`  backend = ${config.storage.backend}`);
		if (config.storage.url) rows.push(`  url = ${config.storage.url}`);
		if (config.storage.path) rows.push(`  path = ${config.storage.path}`);
	}

	if (config.embeddings) {
		rows.push(`[embeddings]`);
		if (config.embeddings.backend) rows.push(`  backend = ${config.embeddings.backend}`);
		if (config.embeddings.url) rows.push(`  url = ${config.embeddings.url}`);
		if (config.embeddings.model) rows.push(`  model = ${config.embeddings.model}`);
		if (config.embeddings.api_key) rows.push(`  api_key = ${"*".repeat(8)}`);
		if (config.embeddings.models_path) rows.push(`  models_path = ${config.embeddings.models_path}`);
	}

	if (config.compression) {
		rows.push(`[compression]`);
		if (config.compression.provider) rows.push(`  provider = ${config.compression.provider}`);
		if (config.compression.model) rows.push(`  model = ${config.compression.model}`);
		if (config.compression.api_key) rows.push(`  api_key = ${"*".repeat(8)}`);
	}

	p.note(rows.join("\n"), "Current Configuration");
}

async function editSection(config: HuskConfig, section: keyof HuskConfig) {
	switch (section) {
		case "server": {
			const port = await p.text({
				message: "Port:",
				initialValue: String(config.server?.port ?? 3000),
				validate: (v) => {
					const n = parseInt(v, 10);
					if (Number.isNaN(n) || n < 1 || n > 65535)
						return "Must be a valid port";
				},
			});
			handleCancel(port);
			if (!config.server) config.server = {};
			config.server.port = parseInt(port, 10);
			break;
		}

		case "storage": {
			const backend = await p.select({
				message: "Storage backend:",
				options: [
					{ value: "sqlite-vec", label: "sqlite-vec" },
					{ value: "qdrant", label: "Qdrant" },
				],
				initialValue: config.storage?.backend ?? "sqlite-vec",
			});
			handleCancel(backend);
			if (!config.storage) config.storage = {};
			config.storage.backend = backend;

			if (backend === "qdrant") {
				const url = await p.text({
					message: "Qdrant URL:",
					initialValue:
						config.storage.url ?? "http://localhost:6333",
				});
				handleCancel(url);
				config.storage.url = url;
			} else {
				const storagePath = await p.text({
					message: "sqlite-vec file path:",
					initialValue: config.storage.path ?? paths.vectorsPath,
				});
				handleCancel(storagePath);
				config.storage.path = storagePath;
			}
			break;
		}

		case "embeddings": {
			const backend = await p.select({
				message: "Embedding provider:",
				options: [
					{ value: "transformers", label: "Transformers" },
					{ value: "ollama", label: "Ollama" },
					{ value: "openai", label: "OpenAI" },
					{ value: "voyage", label: "Voyage" },
					{ value: "llamacpp", label: "llama.cpp" },
				],
				initialValue: config.embeddings?.backend ?? "transformers",
			});
			handleCancel(backend);
			if (!config.embeddings) config.embeddings = {};
			config.embeddings.backend = backend;

			if (
				backend === "ollama" ||
				backend === "openai" ||
				backend === "voyage" ||
				backend === "llamacpp"
			) {
				const url = await p.text({
					message: "Provider URL:",
					initialValue: config.embeddings.url ?? "",
				});
				handleCancel(url);
				if (url) config.embeddings.url = url;
			}

			if (backend === "openai" || backend === "voyage") {
				const apiKey = await p.password({
					message: "API key:",
				});
				handleCancel(apiKey);
				if (apiKey) config.embeddings.api_key = apiKey;
			}

			if (backend !== "transformers") {
				const model = await p.text({
					message: "Model name:",
					initialValue: config.embeddings.model ?? "",
				});
				handleCancel(model);
				if (model) config.embeddings.model = model;
			}
			break;
		}

		case "compression": {
			const enable = await p.confirm({
				message: "Enable compression?",
				initialValue: !!config.compression?.provider,
			});
			handleCancel(enable);

			if (!enable) {
				delete config.compression;
				break;
			}

			const provider = await p.select({
				message: "Provider:",
				options: [
					{ value: "anthropic", label: "Anthropic" },
					{ value: "openrouter", label: "OpenRouter" },
					{ value: "ollama", label: "Ollama" },
				],
				initialValue: config.compression?.provider ?? "anthropic",
			});
			handleCancel(provider);

			if (!config.compression) config.compression = {};
			config.compression.provider = provider;

			if (provider !== "ollama") {
				const apiKey = await p.password({
					message: "API key:",
				});
				handleCancel(apiKey);
				if (apiKey) config.compression.api_key = apiKey;
			}

			const model = await p.text({
				message: "Model:",
				initialValue: config.compression.model ?? "",
			});
			handleCancel(model);
			if (model) config.compression.model = model;
			break;
		}
	}
}
