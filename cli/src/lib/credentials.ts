import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import * as p from "@clack/prompts";
import { paths } from "./paths.js";
import { withSpinner } from "./ui.js";

export interface Credentials {
	url: string;
	apiKey: string;
	username: string;
}

export function readCredentials(): Credentials | null {
	try {
		return JSON.parse(readFileSync(paths.credentials, "utf-8"));
	} catch {
		return null;
	}
}

function saveCredentials(creds: Credentials): void {
	mkdirSync(dirname(paths.credentials), { recursive: true });
	writeFileSync(paths.credentials, JSON.stringify(creds, null, 2));
}

function generatePassword(): string {
	return randomBytes(16).toString("base64url");
}

export async function setupAdmin(
	baseUrl: string,
	username = "admin",
	password?: string,
): Promise<Credentials> {
	const adminPassword = password ?? generatePassword();

	return await withSpinner("Setting up admin account...", async () => {
		// Create admin user via /setup
		const setupRes = await fetch(`${baseUrl}/setup`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, password: adminPassword }),
		});

		if (!setupRes.ok) {
			const err = (await setupRes.json()) as { error?: string };
			throw new Error(err.error ?? `Setup failed: ${setupRes.status}`);
		}

		// Login to get JWT cookie
		const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, password: adminPassword }),
		});

		if (!loginRes.ok) {
			throw new Error("Login failed after setup");
		}

		// Extract session cookie
		const setCookieHeader = loginRes.headers.get("set-cookie");
		const sessionCookie = setCookieHeader
			?.split(";")
			.find((c) => c.trim().startsWith("husk_session="))
			?.split("=")
			.slice(1)
			.join("=");

		if (!sessionCookie) {
			throw new Error("No session cookie returned from login");
		}

		// Create API key
		const keyRes = await fetch(`${baseUrl}/api/keys`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: `husk_session=${sessionCookie}`,
			},
			body: JSON.stringify({ label: "cli-default" }),
		});

		if (!keyRes.ok) {
			throw new Error("Failed to create API key");
		}

		const keyData = (await keyRes.json()) as { key: string };

		const creds: Credentials = {
			url: baseUrl,
			apiKey: keyData.key,
			username,
		};

		saveCredentials(creds);
		return creds;
	});
}

export async function isFirstRun(baseUrl: string): Promise<boolean> {
	try {
		// Hit /setup with GET — if setup guard redirects or we can POST, it's first run
		// Actually check /health and then try a guarded route
		const res = await fetch(`${baseUrl}/api/auth/me`);
		// 503 = setup not completed (no users)
		return res.status === 503;
	} catch {
		return false;
	}
}
