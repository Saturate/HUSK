import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import * as p from "@clack/prompts";
import { paths } from "../lib/paths.js";
import { banner } from "../lib/ui.js";

export async function logsCommand(opts: { follow?: boolean; lines?: number }) {
	banner();

	if (!existsSync(paths.log)) {
		p.log.info(`No log file found at ${paths.log}`);
		p.outro("Server may not have been started yet.");
		return;
	}

	const lines = opts.lines ?? 50;
	const args = opts.follow ? ["-n", String(lines), "-f", paths.log] : ["-n", String(lines), paths.log];

	p.log.info(`Showing ${paths.log}${opts.follow ? " (following)" : ""}`);
	console.log();

	const tail = spawn("tail", args, { stdio: "inherit" });

	await new Promise<void>((resolve) => {
		tail.on("exit", () => resolve());
		process.on("SIGINT", () => {
			tail.kill();
			resolve();
		});
	});
}
