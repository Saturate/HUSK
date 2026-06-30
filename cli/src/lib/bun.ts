import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import { handleCancel, isInteractive, withSpinner } from "./ui.js";

export function findBun(): string | null {
	try {
		const bunPath = execSync("which bun", { encoding: "utf-8" }).trim();
		return bunPath || null;
	} catch {
		return null;
	}
}

export function getBunVersion(bunPath: string): string {
	try {
		return execSync(`${bunPath} --version`, { encoding: "utf-8" }).trim();
	} catch {
		return "unknown";
	}
}

export async function ensureBun(): Promise<string> {
	const existing = findBun();
	if (existing) {
		const version = getBunVersion(existing);
		p.log.success(`Bun ${version} found at ${existing}`);
		return existing;
	}

	if (isInteractive()) {
		const install = await p.confirm({
			message: "Bun is required but not found. Install it now?",
		});
		handleCancel(install);

		if (!install) {
			p.log.error("Bun is required to run the HUSK server.");
			process.exit(1);
		}
	} else {
		p.log.info("Bun is required — installing automatically...");
	}

	return await installBun();
}

function hasCurl(): boolean {
	try {
		execSync("which curl", { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

function hasWget(): boolean {
	try {
		execSync("which wget", { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

async function installBun(): Promise<string> {
	await withSpinner("Installing Bun...", async () => {
		if (hasCurl()) {
			execSync("curl -fsSL https://bun.sh/install | sh", {
				stdio: "pipe",
			});
		} else if (hasWget()) {
			execSync("wget -qO- https://bun.sh/install | sh", {
				stdio: "pipe",
			});
		} else {
			throw new Error("Neither curl nor wget found. Install one of them first, or install Bun manually: https://bun.sh");
		}
	});

	// Re-detect after install
	const bunPath = findBun();
	if (!bunPath) {
		// Try common install locations
		const homeBun = `${process.env.HOME}/.bun/bin/bun`;
		try {
			execSync(`${homeBun} --version`, { stdio: "pipe" });
			p.log.success(`Bun installed at ${homeBun}`);
			return homeBun;
		} catch {
			p.log.error(
				"Bun was installed but could not be found. You may need to restart your shell.",
			);
			process.exit(1);
		}
	}

	const version = getBunVersion(bunPath);
	p.log.success(`Bun ${version} installed`);
	return bunPath;
}
