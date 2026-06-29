import { describe, expect, test } from "bun:test";
import { calculateCacheHitRate, calculateCost, getModelPricing } from "./cost.js";

describe("getModelPricing", () => {
	test("returns fable pricing", () => {
		const p = getModelPricing("claude-fable-5[1m]");
		expect(p.inputPerMillion).toBe(10.0);
		expect(p.outputPerMillion).toBe(50.0);
	});

	test("returns opus pricing", () => {
		const p = getModelPricing("claude-opus-4-6[1m]");
		expect(p.inputPerMillion).toBe(5.0);
		expect(p.outputPerMillion).toBe(25.0);
	});

	test("returns sonnet pricing", () => {
		const p = getModelPricing("claude-sonnet-4-6");
		expect(p.inputPerMillion).toBe(3.0);
		expect(p.outputPerMillion).toBe(15.0);
	});

	test("returns haiku pricing", () => {
		const p = getModelPricing("claude-haiku-4-5-20251001");
		expect(p.inputPerMillion).toBe(1.0);
		expect(p.outputPerMillion).toBe(5.0);
	});

	test("defaults to sonnet for unknown models", () => {
		const p = getModelPricing("unknown-model-xyz");
		expect(p.inputPerMillion).toBe(3.0);
		expect(p.outputPerMillion).toBe(15.0);
	});
});

describe("calculateCost", () => {
	test("1M input tokens on opus = $5.00", () => {
		const cost = calculateCost({
			model: "opus",
			inputTokens: 1_000_000,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheCreateTokens: 0,
		});
		expect(cost).toBe(5.0);
	});

	test("1M output tokens on opus = $25.00", () => {
		const cost = calculateCost({
			model: "opus",
			inputTokens: 0,
			outputTokens: 1_000_000,
			cacheReadTokens: 0,
			cacheCreateTokens: 0,
		});
		expect(cost).toBe(25.0);
	});

	test("cache read gets 90% discount on input rate", () => {
		const cost = calculateCost({
			model: "opus",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 1_000_000,
			cacheCreateTokens: 0,
		});
		expect(cost).toBe(0.5); // 5.0 * 0.1
	});

	test("cache create gets 25% surcharge on input rate", () => {
		const cost = calculateCost({
			model: "opus",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheCreateTokens: 1_000_000,
		});
		expect(cost).toBe(6.25); // 5.0 * 1.25
	});

	test("combined cost calculation", () => {
		const cost = calculateCost({
			model: "sonnet",
			inputTokens: 100_000,
			outputTokens: 50_000,
			cacheReadTokens: 200_000,
			cacheCreateTokens: 10_000,
		});
		// input: 100k * 3/1M = 0.3
		// output: 50k * 15/1M = 0.75
		// cache_read: 200k * 3 * 0.1/1M = 0.06
		// cache_create: 10k * 3 * 1.25/1M = 0.0375
		expect(cost).toBeCloseTo(1.1475, 4);
	});
});

describe("calculateCacheHitRate", () => {
	test("returns 0 when no tokens", () => {
		expect(
			calculateCacheHitRate({ inputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 }),
		).toBe(0);
	});

	test("calculates correct ratio", () => {
		const rate = calculateCacheHitRate({
			inputTokens: 100,
			cacheReadTokens: 400,
			cacheCreateTokens: 0,
		});
		expect(rate).toBe(0.8);
	});
});
