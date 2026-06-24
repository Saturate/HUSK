export interface ModelPricing {
	inputPerMillion: number;
	outputPerMillion: number;
}

const PRICING: Record<string, ModelPricing> = {
	fable: { inputPerMillion: 10.0, outputPerMillion: 50.0 },
	opus: { inputPerMillion: 5.0, outputPerMillion: 25.0 },
	sonnet: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
	haiku: { inputPerMillion: 1.0, outputPerMillion: 5.0 },
};

const DEFAULT_PRICING: ModelPricing = { inputPerMillion: 3.0, outputPerMillion: 15.0 };

export function getModelPricing(model: string): ModelPricing {
	const lower = model.toLowerCase();
	for (const key of Object.keys(PRICING)) {
		if (lower.includes(key)) return PRICING[key] as ModelPricing;
	}
	return DEFAULT_PRICING;
}

export function calculateCost(params: {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreateTokens: number;
}): number {
	const pricing = getModelPricing(params.model);
	const ir = pricing.inputPerMillion;
	const or = pricing.outputPerMillion;

	// cache_read: 90% discount on input rate; cache_create: 25% surcharge on input rate
	const cost =
		(params.inputTokens * ir) / 1_000_000 +
		(params.outputTokens * or) / 1_000_000 +
		(params.cacheReadTokens * ir * 0.1) / 1_000_000 +
		(params.cacheCreateTokens * ir * 1.25) / 1_000_000;

	return Math.round(cost * 1_000_000) / 1_000_000;
}

export function calculateCacheHitRate(params: {
	inputTokens: number;
	cacheReadTokens: number;
	cacheCreateTokens: number;
}): number {
	const total = params.inputTokens + params.cacheReadTokens + params.cacheCreateTokens;
	if (total === 0) return 0;
	return params.cacheReadTokens / total;
}
