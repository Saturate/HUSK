import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

function isMusl(): boolean {
	try {
		const ldd = execSync("ldd --version 2>&1 || true", { encoding: "utf-8" });
		return ldd.includes("musl");
	} catch {
		return false;
	}
}

async function installBun(): Promise<string> {
	if (isMusl()) {
		p.log.error("Bun does not support musl/Alpine Linux. Use a glibc-based image (e.g. node:22 instead of node:22-alpine), or install Bun separately: https://bun.sh");
		process.exit(1);
	}

	const bunDir = join(process.env.HOME ?? "/root", ".bun", "bin");
	const bunPath = join(bunDir, "bun");

	await withSpinner("Installing Bun...", async () => {
		const arch = process.arch === "x64" ? "x64" : "aarch64";
		const platform = process.platform === "darwin" ? "darwin" : "linux";
		const url = `https://github.com/oven-sh/bun/releases/latest/download/bun-${platform}-${arch}.zip`;

		const res = await fetch(url);
		if (!res.ok) throw new Error(`Failed to download Bun: HTTP ${res.status}`);
		const buffer = Buffer.from(await res.arrayBuffer());

		const zipPath = "/tmp/bun-download.zip";
		writeFileSync(zipPath, buffer);

		mkdirSync(bunDir, { recursive: true });
		execSync(`unzip -o ${zipPath} -d /tmp/bun-extract`, { stdio: "pipe" });
		execSync(`cp /tmp/bun-extract/bun-${platform}-${arch}/bun ${bunPath}`, { stdio: "pipe" });
		chmodSync(bunPath, 0o755);
	});

	try {
		const version = execSync(`${bunPath} --version`, { encoding: "utf-8" }).trim();
		p.log.success(`Bun ${version} installed at ${bunPath}`);
		return bunPath;
	} catch {
		p.log.error("Bun was installed but could not be found. You may need to restart your shell.");
		process.exit(1);
	}
}
