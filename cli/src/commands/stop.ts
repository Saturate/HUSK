import * as p from "@clack/prompts";
import { cleanPidFile, isProcessAlive, readPid } from "../lib/server.js";
import { hasService, stopService } from "../lib/service.js";
import { banner } from "../lib/ui.js";

export async function stopCommand() {
	banner();

	// Try OS service first
	if (hasService()) {
		p.log.info("Stopping via OS service...");
		if (stopService()) {
			cleanPidFile();
			p.log.success("HUSK stopped");
			p.outro("Service unloaded. It will not restart automatically until you run `npx husk` again.");
			return;
		}
	}

	// Fall back to PID file
	const pid = readPid();
	if (!pid) {
		p.log.info("No HUSK process found (no PID file)");
		p.outro("Nothing to stop.");
		return;
	}

	if (!isProcessAlive(pid)) {
		p.log.info(`PID ${pid} is not running. Cleaning up stale PID file.`);
		cleanPidFile();
		p.outro("Nothing to stop.");
		return;
	}

	// SIGTERM
	p.log.info(`Stopping HUSK (PID ${pid})...`);
	process.kill(pid, "SIGTERM");

	// Wait for exit
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (!isProcessAlive(pid)) {
			cleanPidFile();
			p.log.success("HUSK stopped");
			p.outro("Server shut down cleanly.");
			return;
		}
		await new Promise((r) => setTimeout(r, 250));
	}

	// Force kill
	p.log.warning("Server did not stop gracefully, sending SIGKILL...");
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// Already dead
	}
	cleanPidFile();
	p.log.success("HUSK killed");
	p.outro("Server force-stopped.");
}
