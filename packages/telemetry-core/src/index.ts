export type {
	SpanKind,
	SpanData,
	TraceData,
	TraceTotals,
	NormalizedEvent,
	SessionState,
	SyncConfig,
} from "./types.js";
export { SPAN_KINDS } from "./types.js";

export {
	calculateCost,
	calculateCacheHitRate,
	getModelPricing,
	type ModelPricing,
} from "./cost.js";

export {
	generateTraceId,
	generateSpanId,
	createTraceData,
	createSpanData,
	endSpan,
} from "./spans.js";

export {
	getLocalDb,
	closeLocalDb,
	insertTrace,
	endTrace as endLocalTrace,
	insertSpan,
	getUnsyncedTraces,
	getUnsyncedSpans,
	markSpansSynced,
	markTracesSynced,
} from "./local-store.js";

export { loadSyncConfig, syncToServer } from "./sync.js";

export {
	loadState,
	saveState,
	deleteState,
	createInitialState,
} from "./state.js";
