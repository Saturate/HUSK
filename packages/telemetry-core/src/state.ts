import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionState } from "./types.js";

const STATE_DIR = join(tmpdir(), "husk-agent");

function statePath(sessionId: string): string {
	return join(STATE_DIR, `${sessionId}.json`);
}

export function loadState(sessionId: string): SessionState | null {
	const path = statePath(sessionId);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as SessionState;
	} catch {
		return null;
	}
}

export function saveState(sessionId: string, state: SessionState): void {
	mkdirSync(STATE_DIR, { recursive: true });
	writeFileSync(statePath(sessionId), JSON.stringify(state));
}

export function deleteState(sessionId: string): void {
	const path = statePath(sessionId);
	try {
		unlinkSync(path);
	} catch {
		// Already gone
	}
}

export function createInitialState(traceId: string, model: string | null): SessionState {
	return {
		traceId,
		model,
		startedAtNs: Number(process.hrtime.bigint()),
		turnCount: 0,
		turnToolCount: 0,
		turnFailureCount: 0,
		currentTurnSpanId: null,
		pendingTools: {},
	};
}
