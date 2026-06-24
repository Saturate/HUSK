import {
	createTraceData,
	insertTrace,
	endLocalTrace,
	createInitialState,
	saveState,
	loadState,
	deleteState,
	loadSyncConfig,
	syncToServer,
} from "@husk/telemetry-core";
import { loadConfig, deriveProject, deriveGitBranch } from "../config.js";

export async function handleSession(
	input: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
	const event = input.hook_event_name as string;
	const sessionId = input.session_id as string;
	const cwd = (input.cwd as string) ?? null;

	if (event === "SessionStart") {
		const model = (input.model as string) ?? null;
		const agentType = (input.agent_type as string) ?? null;
		const project = deriveProject(cwd);
		const gitBranch = deriveGitBranch(cwd);

		const trace = createTraceData({
			sessionId,
			project,
			gitBranch,
			model,
			agentType,
		});

		// Local-first: always persist locally
		insertTrace(trace);

		// Initialize session state
		const state = createInitialState(trace.traceId, model);
		saveState(sessionId, state);

		// Try server sync for context injection
		const config = loadConfig();
		let additionalContext: string | null = null;
		if (config.serverUrl && config.apiKey) {
			try {
				const resp = await fetch(`${config.serverUrl}/hooks/session-start`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${config.apiKey}`,
					},
					body: JSON.stringify({ session_id: sessionId, cwd, project }),
					signal: AbortSignal.timeout(5000),
				});
				if (resp.ok) {
					const data = (await resp.json()) as {
						hookSpecificOutput?: { additionalContext?: string };
					};
					additionalContext = data.hookSpecificOutput?.additionalContext ?? null;
				}
			} catch {
				// Server not available; continue without context
			}

			// Also sync trace to server
			try {
				await fetch(`${config.serverUrl}/telemetry/ingest/traces`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${config.apiKey}`,
					},
					body: JSON.stringify({
						trace_id: trace.traceId,
						project,
						git_branch: gitBranch,
						model,
						agent_type: agentType,
					}),
					signal: AbortSignal.timeout(2000),
				});
			} catch {
				// Will sync later
			}
		}

		if (additionalContext) {
			return {
				hookSpecificOutput: {
					hookEventName: "SessionStart",
					additionalContext,
				},
			};
		}
		return null;
	}

	if (event === "SessionEnd") {
		const state = loadState(sessionId);
		if (state) {
			const durationMs = (Number(process.hrtime.bigint()) - state.startedAtNs) / 1_000_000;

			endLocalTrace(state.traceId, {
				totalInputTokens: 0,
				totalOutputTokens: 0,
				totalCacheReadTokens: 0,
				totalCacheCreateTokens: 0,
				totalCostUsd: 0,
				totalTurns: state.turnCount,
				totalToolCalls: state.turnToolCount,
				totalToolFailures: state.turnFailureCount,
			});

			// Notify server
			const config = loadConfig();
			if (config.serverUrl && config.apiKey) {
				try {
					await fetch(`${config.serverUrl}/hooks/session-end`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${config.apiKey}`,
						},
						body: JSON.stringify({ session_id: sessionId, cwd }),
						signal: AbortSignal.timeout(2000),
					});
				} catch {
					// Best effort
				}

				// Background sync
				const syncConfig = loadSyncConfig();
				syncToServer(syncConfig).catch(() => {});
			}

			deleteState(sessionId);
		}
		return null;
	}

	return null;
}
