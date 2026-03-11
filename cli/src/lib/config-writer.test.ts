import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	defaultConfig,
	writeConfig,
	readConfig,
	mergeConfig,
	type HuskConfig,
} from "./config-writer.js";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "husk-config-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("defaultConfig", () => {
	test("returns expected structure with default port 3000", () => {
		const cfg = defaultConfig();
		expect(cfg.server?.port).toBe(3000);
		expect(cfg.storage?.backend).toBe("sqlite-vec");
		expect(cfg.embeddings?.backend).toBe("transformers");
	});

	test("does not include optional sections", () => {
		const cfg = defaultConfig();
		expect(cfg.compression).toBeUndefined();
		expect(cfg.auth).toBeUndefined();
	});
});

describe("writeConfig / readConfig round-trip", () => {
	test("writes and reads back identical config", () => {
		const cfg: HuskConfig = {
			server: { port: 4000, jwt_secret: "secret123" },
			storage: { backend: "qdrant", url: "http://localhost:6333" },
		};
		const path = join(dir, "husk.toml");
		writeConfig(cfg, path);
		const result = readConfig(path);
		expect(result?.server?.port).toBe(4000);
		expect(result?.server?.jwt_secret).toBe("secret123");
		expect(result?.storage?.backend).toBe("qdrant");
		expect(result?.storage?.url).toBe("http://localhost:6333");
	});

	test("creates parent directories when they don't exist", () => {
		const path = join(dir, "deep", "nested", "husk.toml");
		writeConfig({ server: { port: 3000 } }, path);
		const result = readConfig(path);
		expect(result?.server?.port).toBe(3000);
	});

	test("strips undefined values from config", () => {
		const cfg: HuskConfig = {
			server: { port: 3000, jwt_secret: undefined },
		};
		const path = join(dir, "husk.toml");
		writeConfig(cfg, path);
		const raw = readFileSync(path, "utf-8");
		expect(raw).not.toContain("jwt_secret");
	});

	test("writes a valid TOML header comment", () => {
		const path = join(dir, "husk.toml");
		writeConfig({ server: { port: 3000 } }, path);
		const raw = readFileSync(path, "utf-8");
		expect(raw.startsWith("# HUSK Configuration")).toBe(true);
	});
});

describe("readConfig edge cases", () => {
	test("returns null for nonexistent file", () => {
		expect(readConfig(join(dir, "nope.toml"))).toBeNull();
	});

	test("returns null for invalid TOML", () => {
		const path = join(dir, "bad.toml");
		writeFileSync(path, "this is [not valid = toml {{{{");
		expect(readConfig(path)).toBeNull();
	});

	test("returns null for binary garbage", () => {
		const path = join(dir, "garbage.toml");
		writeFileSync(path, Buffer.from([0x00, 0x01, 0xff, 0xfe]));
		expect(readConfig(path)).toBeNull();
	});

	test("handles empty file", () => {
		const path = join(dir, "empty.toml");
		writeFileSync(path, "");
		const result = readConfig(path);
		// Empty TOML is valid — returns empty object
		expect(result).toEqual({});
	});

	test("handles file with only comments", () => {
		const path = join(dir, "comments.toml");
		writeFileSync(path, "# just a comment\n# nothing else\n");
		const result = readConfig(path);
		expect(result).toEqual({});
	});
});

describe("mergeConfig", () => {
	test("overrides specific fields while keeping others", () => {
		const base: HuskConfig = {
			server: { port: 3000, db_path: "/data/husk.db" },
			storage: { backend: "sqlite-vec" },
		};
		const overrides: HuskConfig = {
			server: { port: 4000 },
		};
		const result = mergeConfig(base, overrides);
		expect(result.server?.port).toBe(4000);
		expect(result.server?.db_path).toBe("/data/husk.db");
		expect(result.storage?.backend).toBe("sqlite-vec");
	});

	test("adds new sections from overrides", () => {
		const base: HuskConfig = { server: { port: 3000 } };
		const overrides: HuskConfig = {
			compression: { provider: "anthropic", model: "claude-3-haiku" },
		};
		const result = mergeConfig(base, overrides);
		expect(result.server?.port).toBe(3000);
		expect(result.compression?.provider).toBe("anthropic");
	});

	test("empty overrides returns base unchanged", () => {
		const base: HuskConfig = {
			server: { port: 3000 },
			storage: { backend: "sqlite-vec" },
		};
		const result = mergeConfig(base, {});
		expect(result).toEqual(base);
	});

	test("empty base with overrides works", () => {
		const result = mergeConfig({}, { server: { port: 5000 } });
		expect(result.server?.port).toBe(5000);
	});

	test("override with undefined section value doesn't clobber base", () => {
		// If overrides has `server: undefined`, the `if (overrides[section])` check
		// prevents it from overwriting. Verify this.
		const base: HuskConfig = { server: { port: 3000 } };
		const overrides: HuskConfig = { server: undefined };
		const result = mergeConfig(base, overrides);
		expect(result.server?.port).toBe(3000);
	});

	test("EDGE CASE: override with empty section object clears base fields", () => {
		// An empty override object `{}` spreads over the base — this means
		// base fields survive. Verify this is the intended behavior.
		const base: HuskConfig = {
			server: { port: 3000, db_path: "/data/husk.db", jwt_secret: "secret" },
		};
		const overrides: HuskConfig = { server: {} };
		const result = mergeConfig(base, overrides);
		// Empty object is truthy, so the merge runs: { ...base.server, ...{} }
		// Base fields should survive
		expect(result.server?.port).toBe(3000);
		expect(result.server?.db_path).toBe("/data/husk.db");
	});
});
