import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateDockerCompose } from "./docker.js";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "husk-docker-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("generateDockerCompose", () => {
	test("generates minimal compose with no services", () => {
		const path = generateDockerCompose({}, dir);
		const content = readFileSync(path, "utf-8");
		expect(content).toContain("services:");
		expect(content).not.toContain("qdrant");
		expect(content).not.toContain("ollama");
		expect(content).not.toContain("volumes:");
	});

	test("generates qdrant service", () => {
		const path = generateDockerCompose({ qdrant: true }, dir);
		const content = readFileSync(path, "utf-8");
		expect(content).toContain("qdrant/qdrant:latest");
		expect(content).toContain("6333:6333");
		expect(content).toContain("qdrant_data:");
		expect(content).toContain("volumes:");
	});

	test("generates ollama with default model", () => {
		const path = generateDockerCompose({ ollama: {} }, dir);
		const content = readFileSync(path, "utf-8");
		expect(content).toContain("ollama/ollama:latest");
		expect(content).toContain("11434:11434");
		expect(content).toContain("nomic-embed-text");
		expect(content).toContain("ollama-pull:");
		expect(content).toContain("service_healthy");
	});

	test("generates ollama with custom model", () => {
		const path = generateDockerCompose(
			{ ollama: { model: "mxbai-embed-large" } },
			dir,
		);
		const content = readFileSync(path, "utf-8");
		expect(content).toContain("mxbai-embed-large");
		expect(content).not.toContain("nomic-embed-text");
	});

	test("generates both qdrant and ollama", () => {
		const path = generateDockerCompose(
			{ qdrant: true, ollama: { model: "nomic-embed-text" } },
			dir,
		);
		const content = readFileSync(path, "utf-8");
		expect(content).toContain("qdrant:");
		expect(content).toContain("ollama:");
		expect(content).toContain("qdrant_data:");
		expect(content).toContain("ollama_data:");
	});

	test("returns correct output path", () => {
		const path = generateDockerCompose({}, dir);
		expect(path).toBe(join(dir, "docker-compose.yml"));
	});

	test("EDGE CASE: model name with double quotes breaks entrypoint JSON", () => {
		// If a user somehow passes a model name containing quotes,
		// the entrypoint JSON becomes malformed
		const path = generateDockerCompose(
			{ ollama: { model: 'foo"bar' } },
			dir,
		);
		const content = readFileSync(path, "utf-8");
		// The entrypoint interpolates the model directly into a JSON string:
		//   curl ... -d '{"name":"foo"bar","stream":false}'
		// This is invalid JSON — the unescaped quote breaks parsing
		expect(content).toContain('foo"bar');
		// BUG: model name is not escaped, producing invalid JSON in the entrypoint
	});

	test("EDGE CASE: model name with single quotes breaks shell", () => {
		const path = generateDockerCompose(
			{ ollama: { model: "foo'bar" } },
			dir,
		);
		const content = readFileSync(path, "utf-8");
		// Single quote inside single-quoted shell string breaks the command
		expect(content).toContain("foo'bar");
		// BUG: no shell escaping applied to model names
	});

	test("EDGE CASE: qdrant: false does not add qdrant service", () => {
		const path = generateDockerCompose({ qdrant: false }, dir);
		const content = readFileSync(path, "utf-8");
		expect(content).not.toContain("qdrant:");
	});
});
