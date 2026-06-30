import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import * as p from "@clack/prompts";
import { readCredentials } from "../lib/credentials.js";
import { banner } from "../lib/ui.js";

interface MemoryFile {
	path: string;
	name: string;
	type: string;
	description: string;
	content: string;
	project: string | null;
	modified_at: string;
	origin_session_id: string | null;
	source_file: string;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
	const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return { meta: {}, body: raw };

	const meta: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const trimmed = line.trim();
		const idx = trimmed.indexOf(":");
		if (idx > 0) {
			const key = trimmed.slice(0, idx).trim();
			const value = trimmed.slice(idx + 1).trim();
			if (value) meta[key] = value;
		}
	}
	return { meta, body: match[2].trim() };
}

/** Reconstruct project name from Claude's dir name by finding the actual directory on disk */
function projectFromPath(dirName: string): string | null {
	// Strip everything before 'code-' to get the project path segments
	const codeIdx = dirName.indexOf("-code-");
	if (codeIdx < 0) return null;
	const rest = dirName.slice(codeIdx + 6); // after "-code-"

	// Strip "github-" prefix if present
	const projectPart = rest.startsWith("github-") ? rest.slice(7) : rest;
	if (!projectPart) return null;

	// Reconstruct the filesystem path from the home dir
	const homePrefix = dirName.slice(1, codeIdx).replaceAll("-", "/"); // "Users/alkj"
	const codePath = `/${homePrefix}/code`;
	const githubPath = `${codePath}/github`;

	// Try to find the actual directory by testing path candidates
	// The challenge: hyphens could be path separators OR literal hyphens in dir names
	// Strategy: try git remote from the most likely paths
	const candidates: string[] = [];

	// Direct match under github/
	if (rest.startsWith("github-")) {
		candidates.push(join(githubPath, projectPart.replaceAll("-", "/")));
		candidates.push(join(githubPath, projectPart));
	}

	// Direct match under code/
	candidates.push(join(codePath, rest.replaceAll("-", "/")));
	candidates.push(join(codePath, rest));

	for (const candidate of candidates) {
		try {
			if (!statSync(candidate).isDirectory()) continue;
			const remote = execSync("git remote get-url origin", {
				cwd: candidate,
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 2000,
			}).toString().trim();
			const repoMatch = remote.match(/[/:]([^/]+?)(?:\.git)?$/);
			if (repoMatch) return repoMatch[1];
		} catch {
			continue;
		}
	}

	// Fallback: use the last segment, replacing hyphens with dots for known patterns
	// e.g., "DCC-Frontends" -> try "DCC.Frontends"
	return projectPart;
}

function discoverClaudeMemories(): MemoryFile[] {
	const claudeDir = join(homedir(), ".claude", "projects");
	const memories: MemoryFile[] = [];

	let projectDirs: string[];
	try {
		projectDirs = readdirSync(claudeDir);
	} catch {
		return memories;
	}

	for (const dir of projectDirs) {
		const memoryDir = join(claudeDir, dir, "memory");
		try {
			if (!statSync(memoryDir).isDirectory()) continue;
		} catch {
			continue;
		}

		const files = readdirSync(memoryDir).filter(
			(f) => f.endsWith(".md") && f !== "MEMORY.md",
		);

		for (const file of files) {
			const filePath = join(memoryDir, file);
			const raw = readFileSync(filePath, "utf-8");
			const { meta, body } = parseFrontmatter(raw);

			if (!body) continue;

			const mtime = statSync(filePath).mtime.toISOString();
			memories.push({
				path: filePath,
				name: meta.name ?? basename(file, ".md"),
				type: meta.type ?? "project",
				description: meta.description ?? "",
				content: body,
				project: projectFromPath(dir),
				modified_at: mtime,
				origin_session_id: meta.originSessionId ?? null,
				source_file: file,
			});
		}
	}

	return memories;
}

function memoryTypeFromClaude(type: string): string {
	const map: Record<string, string> = {
		user: "fact",
		feedback: "lesson",
		project: "fact",
		reference: "fact",
	};
	return map[type] ?? "fact";
}

function scopeFromType(type: string): "session" | "project" | "global" {
	if (type === "user" || type === "feedback") return "global";
	if (type === "reference") return "global";
	return "project";
}

export async function syncCommand(opts?: { dryRun?: boolean }) {
	const dryRun = opts?.dryRun ?? false;

	banner();
	p.intro(dryRun ? "Sync (dry run)" : "Sync Claude Code memories to HUSK");

	const memories = discoverClaudeMemories();

	if (memories.length === 0) {
		p.log.info("No Claude Code memories found to sync.");
		p.outro("");
		return;
	}

	const projects = new Set(memories.map((m) => m.project).filter(Boolean));
	p.log.info(`Found ${memories.length} memories across ${projects.size} projects`);

	if (dryRun) {
		for (const mem of memories) {
			const scope = scopeFromType(mem.type);
			const type = memoryTypeFromClaude(mem.type);
			p.log.info(`[${type}] ${mem.name} (${scope}${mem.project ? ` · ${mem.project}` : ""}) — ${mem.content.length} chars`);
		}
		p.outro(`Dry run: ${memories.length} memories would be synced`);
		return;
	}

	const envUrl = process.env.HUSK_URL;
	const envKey = process.env.HUSK_API_KEY;
	const creds = envUrl && envKey
		? { url: envUrl, apiKey: envKey, username: "env" }
		: readCredentials();
	if (!creds) {
		p.log.error("No credentials found. Set HUSK_URL + HUSK_API_KEY or run `husk init`.");
		process.exit(1);
	}

	try {
		const res = await fetch(`${creds.url}/health`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
	} catch {
		p.log.error(`Cannot reach HUSK at ${creds.url}`);
		process.exit(1);
	}

	let imported = 0;
	let duplicates = 0;
	let errors = 0;

	for (const mem of memories) {
		const scope = scopeFromType(mem.type);

		try {
			const res = await fetch(`${creds.url}/ingest`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${creds.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					summary: mem.content,
					scope,
					git_remote: mem.project,
					title: mem.description || mem.name,
					memory_type: memoryTypeFromClaude(mem.type),
					created_at: mem.modified_at,
					metadata: {
						source: "claude_code_sync",
						claude_name: mem.name,
						claude_type: mem.type,
						origin_session_id: mem.origin_session_id,
						source_file: mem.source_file,
						source_path: mem.path,
					},
				}),
			});

			if (res.ok) {
				const data = (await res.json()) as { duplicate?: boolean; id?: string };
				if (data.duplicate) {
					duplicates++;
					p.log.warn(`${mem.name} (duplicate)`);
				} else {
					imported++;
					p.log.success(`${mem.name} (${scope}${mem.project ? ` · ${mem.project}` : ""})`);
				}
			} else if (res.status === 429) {
				p.log.warn(`${mem.name}: rate limited, waiting...`);
				await new Promise((r) => setTimeout(r, 2000));
				errors++;
			} else {
				errors++;
				try {
					const err = (await res.json()) as { error?: string };
					p.log.error(`${mem.name}: ${err.error ?? res.statusText}`);
				} catch {
					p.log.error(`${mem.name}: HTTP ${res.status}`);
				}
			}
			await new Promise((r) => setTimeout(r, 100));
		} catch (err) {
			errors++;
			p.log.error(`${mem.name}: ${err instanceof Error ? err.message : "failed"}`);
		}
	}

	p.outro(`Done: ${imported} imported, ${duplicates} duplicates, ${errors} errors`);
}
