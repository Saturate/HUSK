import { execSync } from "node:child_process";
import type { Plugin } from "@opencode-ai/plugin";
import { checkHealth, postIngest } from "./husk-client.js";
import { getGitRemote, getProjectName } from "./util.js";

// Per-session state — keyed by session ID to handle concurrent sessions
const sessions = new Map<string, Set<string>>();

function env(key: string): string | undefined {
	return process.env[key];
}

function tryAutoStart() {
	try {
		execSync("npx husk", { stdio: "ignore", timeout: 5000 });
	} catch {
		// best-effort
	}
}

async function flushSession(sessionId: string, reason: string, cwd: string) {
	const url = env("HUSK_URL");
	const key = env("HUSK_KEY");
	if (!url || !key) return;

	const editedFiles = sessions.get(sessionId);

	try {
		await postIngest(url, key, {
			summary: `Coding session on ${getProjectName(cwd)} (${reason})`,
			git_remote: getGitRemote(cwd),
			scope: "session",
			metadata: {
				session_id: sessionId,
				reason,
				cwd,
				files_edited: editedFiles ? [...editedFiles] : [],
			},
		});
	} catch {
		// best-effort — never block the editor
	} finally {
		sessions.delete(sessionId);
	}
}

export const plugin: Plugin = async ({ directory }) => {
	const cwd = directory;

	return {
		event: async ({ event }) => {
			if (event.type === "session.created") {
				const sid = event.properties.info.id;
				sessions.set(sid, new Set());

				const url = env("HUSK_URL");
				if (!url) return;

				const healthy = await checkHealth(url);
				if (!healthy) tryAutoStart();
			}

			if (event.type === "file.edited") {
				const file = event.properties.file;
				// file.edited doesn't carry a session ID, so add to all active sessions
				for (const tracked of sessions.values()) {
					tracked.add(file);
				}
			}

			if (event.type === "session.deleted") {
				const sid = event.properties.info.id;
				await flushSession(sid, "ended", cwd);
			}

			if (event.type === "session.error") {
				const sid = event.properties.sessionID;
				if (sid) await flushSession(sid, "error", cwd);
			}
		},

		"shell.env": async (_input, output) => {
			const url = env("HUSK_URL");
			const key = env("HUSK_KEY");
			if (url) output.env.HUSK_URL = url;
			if (key) output.env.HUSK_KEY = key;
		},
	};
};
