import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getManualConfig, registerCursor } from "./mcp-register.js";

describe("getManualConfig", () => {
	test("produces valid JSON with correct structure", () => {
		const config = getManualConfig("http://localhost:3000", "husk_abc123");
		const parsed = JSON.parse(config);
		expect(parsed.mcpServers.husk.type).toBe("http");
		expect(parsed.mcpServers.husk.url).toBe("http://localhost:3000/mcp");
		expect(parsed.mcpServers.husk.headers.Authorization).toBe(
			"Bearer husk_abc123",
		);
	});

	test("EDGE CASE: trailing slash in URL creates double slash", () => {
		const config = getManualConfig("http://localhost:3000/", "husk_abc123");
		const parsed = JSON.parse(config);
		// URL becomes "http://localhost:3000//mcp" — double slash
		expect(parsed.mcpServers.husk.url).toBe("http://localhost:3000//mcp");
		// BUG: no trailing slash normalization
	});

	test("EDGE CASE: empty API key produces empty bearer token", () => {
		const config = getManualConfig("http://localhost:3000", "");
		const parsed = JSON.parse(config);
		expect(parsed.mcpServers.husk.headers.Authorization).toBe("Bearer ");
		// BUG: no validation that API key is non-empty
	});

	test("EDGE CASE: empty URL produces bare /mcp path", () => {
		const config = getManualConfig("", "husk_key");
		const parsed = JSON.parse(config);
		expect(parsed.mcpServers.husk.url).toBe("/mcp");
		// BUG: no validation that URL is a proper URL
	});
});

describe("registerCursor", () => {
	let dir: string;
	let originalHomedir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "husk-cursor-test-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	// Note: registerCursor uses homedir() internally so we can't easily redirect it.
	// These tests document the behavior we'd want to verify with proper DI.

	test("getManualConfig handles special characters in API key", () => {
		// API keys with special chars in JSON should be properly escaped
		const config = getManualConfig(
			"http://localhost:3000",
			'key_with"quotes',
		);
		// JSON.stringify handles the escaping
		const parsed = JSON.parse(config);
		expect(parsed.mcpServers.husk.headers.Authorization).toBe(
			'Bearer key_with"quotes',
		);
	});

	test("getManualConfig with IPv6 URL", () => {
		const config = getManualConfig("http://[::1]:3000", "husk_key");
		const parsed = JSON.parse(config);
		expect(parsed.mcpServers.husk.url).toBe("http://[::1]:3000/mcp");
	});
});
