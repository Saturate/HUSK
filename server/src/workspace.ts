import { type WorkspaceRow, getDb, getWorkspaceByName, getWorkspaceForProject } from "./db.js";

/**
 * Parse an org/group name from a git remote URL.
 * Handles HTTPS and SSH formats for GitHub, GitLab, Bitbucket, Azure DevOps.
 */
export function inferWorkspaceFromRemote(gitRemote: string): string | null {
	// SSH: git@github.com:org/repo.git
	const sshMatch = gitRemote.match(/^git@[^:]+:([^/]+)\//);
	if (sshMatch?.[1]) return sshMatch[1];

	// HTTPS: https://github.com/org/repo or https://dev.azure.com/org/project
	try {
		const url = new URL(gitRemote);
		const parts = url.pathname.split("/").filter(Boolean);
		if (parts.length >= 2 && parts[0]) return parts[0];
	} catch {
		// Not a valid URL
	}

	return null;
}

/**
 * Resolve a workspace for a git remote, scoped to a specific user:
 * 1. Check explicit mapping in workspace_projects table (owned by userId)
 * 2. If auto-detect enabled, infer org name and look up existing workspace by name (owned by userId)
 *
 * Only resolves to existing workspaces owned by the user — never auto-creates.
 */
export function resolveWorkspace(
	gitRemote: string | null | undefined,
	opts?: { autoDetect?: boolean; userId?: string },
): WorkspaceRow | undefined {
	if (!gitRemote) return undefined;

	// Explicit mapping takes priority
	const explicit = getWorkspaceForProject(gitRemote, opts?.userId);
	if (explicit) return explicit;

	// Auto-detect: try multiple strategies
	if (opts?.autoDetect !== false) {
		// Strategy 1: infer org from git remote URL
		const inferred = inferWorkspaceFromRemote(gitRemote);
		if (inferred) {
			const ws = getWorkspaceByName(inferred, opts?.userId);
			if (ws) return ws;
		}

		// Strategy 2: prefix match on project name (DCC.Frontends -> workspace "DCC")
		const workspaces = getDb()
			.query<WorkspaceRow, []>(
				opts?.userId
					? `SELECT * FROM workspaces WHERE created_by = '${opts.userId}' ORDER BY length(name) DESC`
					: "SELECT * FROM workspaces ORDER BY length(name) DESC",
			)
			.all();

		for (const ws of workspaces) {
			if (
				gitRemote === ws.name ||
				gitRemote.startsWith(`${ws.name}.`) ||
				gitRemote.startsWith(`${ws.name}/`)
			) {
				return ws;
			}
		}
	}

	return undefined;
}
