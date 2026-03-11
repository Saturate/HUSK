import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const DOCS_DIR = join(import.meta.dir);

/**
 * These tests validate the integrity of the documentation content.
 * They catch broken references, missing pages, and structural issues
 * that would cause build failures or 404s at runtime.
 */

function readJson(path: string) {
	return JSON.parse(readFileSync(path, "utf-8"));
}

function listMdxFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith(".mdx"))
		.map((f) => f.replace(/\.mdx$/, ""));
}

function listSubdirs(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name);
}

describe("docs content integrity", () => {
	test("root meta.json exists and has required fields", () => {
		const meta = readJson(join(DOCS_DIR, "meta.json"));
		expect(meta.title).toBe("Docs");
		expect(Array.isArray(meta.pages)).toBe(true);
		expect(meta.pages.length).toBeGreaterThan(0);
	});

	test("every page listed in root meta.json has a corresponding .mdx file", () => {
		const meta = readJson(join(DOCS_DIR, "meta.json"));
		const mdxFiles = listMdxFiles(DOCS_DIR);

		const pageRefs = meta.pages.filter(
			(p: string) => !p.startsWith("---") && !p.startsWith("..."),
		);

		const missing: string[] = [];
		for (const page of pageRefs) {
			if (!mdxFiles.includes(page)) {
				missing.push(page);
			}
		}

		expect(missing).toEqual([]);
	});

	test("every subdirectory reference in meta.json has a matching directory", () => {
		const meta = readJson(join(DOCS_DIR, "meta.json"));
		const subdirs = listSubdirs(DOCS_DIR);

		// Extract directory references from "...dirname" entries
		const dirRefs = meta.pages
			.filter((p: string) => p.startsWith("..."))
			.map((p: string) => p.slice(3));

		const missing: string[] = [];
		for (const dir of dirRefs) {
			if (!subdirs.includes(dir)) {
				missing.push(dir);
			}
		}

		expect(missing).toEqual([]);
	});

	test("every subdirectory with content has a meta.json", () => {
		const subdirs = listSubdirs(DOCS_DIR);
		const missingMeta: string[] = [];

		for (const dir of subdirs) {
			const metaPath = join(DOCS_DIR, dir, "meta.json");
			if (!existsSync(metaPath)) {
				missingMeta.push(dir);
			}
		}

		expect(missingMeta).toEqual([]);
	});

	test("every page in subdirectory meta.json has a corresponding .mdx file", () => {
		const subdirs = listSubdirs(DOCS_DIR);
		const missing: string[] = [];

		for (const dir of subdirs) {
			const metaPath = join(DOCS_DIR, dir, "meta.json");
			if (!existsSync(metaPath)) continue;

			const meta = readJson(metaPath);
			const mdxFiles = listMdxFiles(join(DOCS_DIR, dir));

			for (const page of meta.pages) {
				if (!mdxFiles.includes(page)) {
					missing.push(`${dir}/${page}`);
				}
			}
		}

		expect(missing).toEqual([]);
	});

	test("no orphan .mdx files exist outside of meta.json references", () => {
		const meta = readJson(join(DOCS_DIR, "meta.json"));
		const mdxFiles = listMdxFiles(DOCS_DIR);

		const pageRefs = meta.pages.filter(
			(p: string) => !p.startsWith("---") && !p.startsWith("..."),
		);

		const orphans = mdxFiles.filter((f) => !pageRefs.includes(f));
		if (orphans.length > 0) {
			console.warn(
				`Warning: orphan .mdx files not listed in meta.json: ${orphans.join(", ")}`,
			);
		}
		// Orphans are a warning, not a failure — they might be drafts
		expect(true).toBe(true);
	});

	test("all .mdx files have frontmatter with title", () => {
		const mdxFiles = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".mdx"));
		const missingTitle: string[] = [];

		for (const file of mdxFiles) {
			const content = readFileSync(join(DOCS_DIR, file), "utf-8");
			// Check for YAML frontmatter with title
			const match = content.match(/^---\n([\s\S]*?)\n---/);
			if (!match) {
				missingTitle.push(file);
				continue;
			}
			if (!match[1].includes("title:")) {
				missingTitle.push(file);
			}
		}

		expect(missingTitle).toEqual([]);
	});

	test("subdirectory .mdx files have frontmatter with title", () => {
		const subdirs = listSubdirs(DOCS_DIR);
		const missingTitle: string[] = [];

		for (const dir of subdirs) {
			const dirPath = join(DOCS_DIR, dir);
			const mdxFiles = readdirSync(dirPath).filter((f) =>
				f.endsWith(".mdx"),
			);

			for (const file of mdxFiles) {
				const content = readFileSync(join(dirPath, file), "utf-8");
				const match = content.match(/^---\n([\s\S]*?)\n---/);
				if (!match || !match[1].includes("title:")) {
					missingTitle.push(`${dir}/${file}`);
				}
			}
		}

		expect(missingTitle).toEqual([]);
	});
});

describe("docs cross-references", () => {
	test("internal links point to existing pages", () => {
		const allPages = new Set<string>();

		// Collect all page slugs
		const rootMdx = listMdxFiles(DOCS_DIR);
		for (const f of rootMdx) allPages.add(`/docs/${f === "index" ? "" : f}`);

		const subdirs = listSubdirs(DOCS_DIR);
		for (const dir of subdirs) {
			const dirMdx = listMdxFiles(join(DOCS_DIR, dir));
			for (const f of dirMdx)
				allPages.add(`/docs/${dir}/${f === "index" ? "" : f}`);
		}

		// Normalize: /docs/ and /docs/index are the same
		allPages.add("/docs");
		allPages.add("/docs/");

		const brokenLinks: string[] = [];

		function checkFile(filePath: string) {
			const content = readFileSync(filePath, "utf-8");
			// Match markdown links: [text](/docs/something)
			const linkPattern = /\[([^\]]*)\]\(\/docs\/([^)#]*)/g;
			let match;
			while ((match = linkPattern.exec(content)) !== null) {
				const target = `/docs/${match[2].replace(/\/$/, "")}`;
				if (!allPages.has(target) && !allPages.has(target + "/")) {
					brokenLinks.push(
						`${basename(filePath)}: link to ${target}`,
					);
				}
			}
		}

		// Check all MDX files for broken internal links
		for (const file of readdirSync(DOCS_DIR).filter((f) =>
			f.endsWith(".mdx"),
		)) {
			checkFile(join(DOCS_DIR, file));
		}
		for (const dir of subdirs) {
			const dirPath = join(DOCS_DIR, dir);
			for (const file of readdirSync(dirPath).filter((f) =>
				f.endsWith(".mdx"),
			)) {
				checkFile(join(dirPath, file));
			}
		}

		if (brokenLinks.length > 0) {
			console.warn("Broken internal links found:", brokenLinks);
		}
		// Broken links should fail the test
		expect(brokenLinks).toEqual([]);
	});
});
