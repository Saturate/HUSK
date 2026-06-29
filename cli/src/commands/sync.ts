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
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
	const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return { meta: {}, body: raw };

	const meta: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const idx = line.indexOf(":");
		if (idx > 0) {
			meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
		}
	}
	return { meta, body: match[2].trim() };
}

/** Extract project name from Claude memory path like -Users-alkj-code-github-PROJECTNAME */
function projectFromPath(memoryPath: string): string | null {
	const match = memoryPath.match(/-Users-[^/]+-code-(?:github-)?([^/]+)/);
	return match ? match[1] : null;
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

			memories.push({
				path: filePath,
				name: meta.name ?? basename(file, ".md"),
				type: meta.type ?? "project",
				description: meta.description ?? "",
				content: body,
				project: projectFromPath(dir),
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

	const creds = readCredentials();
	if (!creds) {
		p.log.error("No credentials found. Run `husk init` first.");
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
					metadata: {
						source: "claude_code_sync",
						claude_name: mem.name,
						claude_type: mem.type,
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
			} else {
				errors++;
				const err = (await res.json()) as { error?: string };
				p.log.error(`${mem.name}: ${err.error ?? res.statusText}`);
			}
		} catch (err) {
			errors++;
			p.log.error(`${mem.name}: ${err instanceof Error ? err.message : "failed"}`);
		}
	}

	p.outro(`Done: ${imported} imported, ${duplicates} duplicates, ${errors} errors`);
}
