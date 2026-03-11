import { describe, expect, test } from "bun:test";
import { isFirstRun } from "./credentials.js";

describe("isFirstRun", () => {
	test("returns false when server is unreachable", async () => {
		// Unreachable server should return false (not throw)
		const result = await isFirstRun("http://localhost:19999");
		expect(result).toBe(false);
	});

	test("returns false for invalid URL", async () => {
		// Completely invalid URL — fetch should throw, caught and returns false
		const result = await isFirstRun("not-a-url");
		expect(result).toBe(false);
	});

	test("EDGE CASE: returns false for empty URL", async () => {
		const result = await isFirstRun("");
		expect(result).toBe(false);
	});
});
