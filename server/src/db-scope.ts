import {
	type MemoryRow,
	type WorkspaceRow,
	countMemories,
	deleteMemory,
	getMemoryForUser,
	getWorkspaceForProject,
	listDistinctGitRemotes,
	listDistinctMemoryTypes,
	listDistinctPaths,
	listDistinctScopes,
	listMemories,
	restoreMemory,
	softDeleteMemory,
} from "./db-memories.js";
import {
	type ObservationRow,
	type SessionRow,
	countSessions,
	deleteSession,
	getObservationForUser,
	getSessionForUser,
	getUncompressedObservationsForUser,
	listSessions,
	validateObservationIds,
} from "./db-sessions.js";

export class UserScope {
	constructor(readonly userId: string) {}

	// --- Memories ---

	getMemory(id: string): MemoryRow | undefined {
		return getMemoryForUser(id, this.userId);
	}

	listMemories(opts?: {
		gitRemote?: string;
		scope?: string;
		limit?: number;
		offset?: number;
		memoryType?: string;
		path?: string;
		includeDeleted?: boolean;
	}): MemoryRow[] {
		return listMemories({ ...opts, userId: this.userId });
	}

	countMemories(opts?: {
		gitRemote?: string;
		scope?: string;
		memoryType?: string;
		path?: string;
		includeDeleted?: boolean;
	}): number {
		return countMemories({ ...opts, userId: this.userId });
	}

	deleteMemory(id: string): boolean {
		const memory = getMemoryForUser(id, this.userId);
		if (!memory) return false;
		return deleteMemory(id);
	}

	softDeleteMemory(id: string): boolean {
		const memory = getMemoryForUser(id, this.userId);
		if (!memory) return false;
		return softDeleteMemory(id);
	}

	restoreMemory(id: string): boolean {
		const memory = getMemoryForUser(id, this.userId);
		if (!memory) return false;
		return restoreMemory(id);
	}

	listGitRemotes(): string[] {
		return listDistinctGitRemotes(this.userId);
	}

	listScopes(): string[] {
		return listDistinctScopes(this.userId);
	}

	listMemoryTypes(): string[] {
		return listDistinctMemoryTypes(this.userId);
	}

	listPaths(): string[] {
		return listDistinctPaths(this.userId);
	}

	// --- Sessions ---

	getSession(id: string): SessionRow | undefined {
		return getSessionForUser(id, this.userId);
	}

	listSessions(opts?: {
		project?: string;
		status?: string;
		limit?: number;
		offset?: number;
	}): SessionRow[] {
		return listSessions({ ...opts, userId: this.userId });
	}

	countSessions(opts?: { status?: string }): number {
		return countSessions({ ...opts, userId: this.userId });
	}

	deleteSession(id: string): boolean {
		const session = getSessionForUser(id, this.userId);
		if (!session) return false;
		return deleteSession(id);
	}

	// --- Observations ---

	getObservation(id: string): ObservationRow | undefined {
		return getObservationForUser(id, this.userId);
	}

	getUncompressedObservations(sessionId: string, limit?: number): ObservationRow[] {
		return getUncompressedObservationsForUser(sessionId, this.userId, limit);
	}

	validateObservationIds(ids: string[]): boolean {
		return validateObservationIds(ids, this.userId);
	}

	// --- Workspaces ---

	resolveWorkspaceForRemote(gitRemote: string): WorkspaceRow | undefined {
		return getWorkspaceForProject(gitRemote, this.userId);
	}
}
