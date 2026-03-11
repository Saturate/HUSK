import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatBytes, progressBar } from "./server.js";

describe("formatBytes", () => {
	test("formats bytes", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(1)).toBe("1 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1023)).toBe("1023 B");
	});

	test("formats kilobytes", () => {
		expect(formatBytes(1024)).toBe("1.0 KB");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(1024 * 100)).toBe("100.0 KB");
	});

	test("formats megabytes", () => {
		expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
		expect(formatBytes(1024 * 1024 * 5.5)).toBe("5.5 MB");
	});

	test("EDGE CASE: does not handle gigabytes — shows as MB", () => {
		// 1 GB = 1073741824 bytes, currently displays as "1024.0 MB"
		// This is a missing feature — no GB/TB formatting
		const result = formatBytes(1024 * 1024 * 1024);
		expect(result).toBe("1024.0 MB");
		// NOTE: Should ideally be "1.0 GB"
	});

	test("EDGE CASE: negative bytes produce misleading output", () => {
		// Negative bytes shouldn't happen but the function doesn't guard against it
		const result = formatBytes(-100);
		expect(result).toBe("-100 B");
	});

	test("EDGE CASE: very large values overflow MB display", () => {
		// 1 TB shown as MB
		const result = formatBytes(1024 * 1024 * 1024 * 1024);
		expect(result).toBe("1048576.0 MB");
	});
});

describe("progressBar", () => {
	test("empty bar at 0%", () => {
		const bar = progressBar(0);
		expect(bar).toBe("\u2591".repeat(20));
		expect(bar.length).toBe(20);
	});

	test("full bar at 100%", () => {
		const bar = progressBar(1);
		expect(bar).toBe("\u2588".repeat(20));
		expect(bar.length).toBe(20);
	});

	test("half bar at 50%", () => {
		const bar = progressBar(0.5);
		expect(bar).toBe("\u2588".repeat(10) + "\u2591".repeat(10));
	});

	test("custom width", () => {
		const bar = progressBar(0.5, 10);
		expect(bar.length).toBe(10);
		expect(bar).toBe("\u2588".repeat(5) + "\u2591".repeat(5));
	});

	test("EDGE CASE: ratio > 1 throws RangeError", () => {
		// If download reports more bytes than content-length (e.g. gzip mismatch),
		// ratio can exceed 1.0 — Math.round(1.5 * 10) = 15 filled,
		// repeat(10 - 15) = repeat(-5) throws RangeError
		expect(() => progressBar(1.5, 10)).toThrow(RangeError);
		// BUG: no clamping applied to ratio
	});

	test("EDGE CASE: negative ratio throws", () => {
		// Negative ratio shouldn't happen but produces negative repeat
		expect(() => progressBar(-0.5)).toThrow();
	});

	test("EDGE CASE: NaN ratio produces empty bar", () => {
		// NaN * 20 = NaN, Math.round(NaN) = NaN, "".repeat(NaN) = ""
		const bar = progressBar(NaN);
		expect(bar).toBe("");
		// BUG: bar is empty string instead of proper empty bar
	});
});
