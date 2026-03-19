import { execSync } from "node:child_process";
import { basename } from "node:path";

/** Returns "owner/repo" from git remote origin, or null */
export function getGitRemote(cwd: string): string | null {
	try {
		const raw = execSync("git remote get-url origin", { cwd, encoding: "utf-8", timeout: 3000 }).trim();
		// Strip to owner/repo — handles both SSH and HTTPS URLs
		return raw.replace(/.*github\.com[:/]/, "").replace(/\.git$/, "") || null;
	} catch {
		return null;
	}
}

/** Basename of the working directory, used as a human-friendly project name */
export function getProjectName(cwd: string): string {
	return basename(cwd) || "unknown";
}
