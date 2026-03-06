import * as p from "@clack/prompts";
import { setupAdmin, isFirstRun } from "../lib/credentials.js";
import {
	detectClients,
	getManualConfig,
	registerClients,
} from "../lib/mcp-register.js";
import { banner, handleCancel } from "../lib/ui.js";

export async function serverSetupCommand() {
	banner();

	const url = await p.text({
		message: "Server URL:",
		placeholder: "https://husk.example.com",
		validate: (v) => {
			if (!v.startsWith("http://") && !v.startsWith("https://"))
				return "Must start with http:// or https://";
		},
	});
	handleCancel(url);

	const baseUrl = url.replace(/\/+$/, "");

	// Check reachable
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

	// Check if setup is needed
	const needsSetup = await isFirstRun(baseUrl);

	if (!needsSetup) {
		p.log.warning("Server already has an admin account.");
		p.log.info("Use `husk init` → 'Connect to remote server' to connect with an existing API key.");
		p.outro("");
		process.exit(0);
	}

	p.log.info("Server has no users — let's create the first admin.");

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

	const creds = await setupAdmin(baseUrl, username, password);
	p.log.success(`Admin created: ${creds.username}`);
	p.log.success(`API key: ${creds.apiKey}`);

	// MCP registration
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
			baseUrl,
			creds.apiKey,
			clientsToRegister,
		);
		for (const name of registered) {
			p.log.success(`Registered with ${name}`);
		}
	}
	if (mcpChoices.includes("manual")) {
		console.log(getManualConfig(baseUrl, creds.apiKey));
	}

	p.note(
		[
			`Server:  ${baseUrl}`,
			`API Key: ${creds.apiKey}`,
		].join("\n"),
		"Remote HUSK configured",
	);

	p.outro("Setup complete!");
	process.exit(0);
}
