import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { paths } from "./paths.js";

const home = homedir();

describe("paths", () => {
	test("home is ~/.husk", () => {
		expect(paths.home).toBe(join(home, ".husk"));
	});

	test("all data paths resolve to exact locations", () => {
		expect(paths.server).toBe(join(home, ".husk", "server"));
		expect(paths.data).toBe(join(home, ".husk", "data"));
		expect(paths.config).toBe(join(home, ".husk", "husk.toml"));
		expect(paths.credentials).toBe(join(home, ".husk", "credentials.json"));
		expect(paths.log).toBe(join(home, ".husk", "husk.log"));
		expect(paths.pid).toBe(join(home, ".husk", "husk.pid"));
		expect(paths.version).toBe(join(home, ".husk", "version.json"));
		expect(paths.modelsPath).toBe(join(home, ".husk", "data", "models"));
		expect(paths.dbPath).toBe(join(home, ".husk", "data", "husk.db"));
		expect(paths.vectorsPath).toBe(
			join(home, ".husk", "data", "husk-vectors.db"),
		);
	});

	test("launchd plist under ~/Library/LaunchAgents", () => {
		expect(paths.launchdPlist).toBe(
			join(home, "Library", "LaunchAgents", "io.husk.server.plist"),
		);
	});

	test("systemd unit under ~/.config/systemd/user", () => {
		expect(paths.systemdUnit).toBe(
			join(home, ".config", "systemd", "user", "husk.service"),
		);
	});

	test("no double slashes in any path", () => {
		for (const [key, value] of Object.entries(paths)) {
			expect(value).not.toContain("//");
		}
	});
});

describe("HUSK_HOME override", () => {
	test("HUSK_HOME env var overrides all paths", () => {
		const customHome = "/tmp/custom-husk-home";
		const scriptPath = join(import.meta.dir, "_husk_home_test.ts");
		writeFileSync(
			scriptPath,
			'import { paths } from "./paths.js";\nprocess.stdout.write(JSON.stringify(paths));',
		);
		try {
			const result = Bun.spawnSync({
				cmd: ["bun", scriptPath],
				env: { ...process.env, HUSK_HOME: customHome },
			});
			const overridden = JSON.parse(result.stdout.toString());
			expect(overridden.home).toBe(customHome);
			expect(overridden.server).toBe(join(customHome, "server"));
			expect(overridden.data).toBe(join(customHome, "data"));
			expect(overridden.credentials).toBe(join(customHome, "credentials.json"));
			expect(overridden.config).toBe(join(customHome, "husk.toml"));
			expect(overridden.log).toBe(join(customHome, "husk.log"));
			expect(overridden.pid).toBe(join(customHome, "husk.pid"));
			expect(overridden.version).toBe(join(customHome, "version.json"));
		} finally {
			try {
				unlinkSync(scriptPath);
			} catch {}
		}
	});
});
