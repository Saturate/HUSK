import { app } from "./app.js";
import { initDb } from "./db.js";
import { resetRateLimiters } from "./rate-limit.js";

export function createTestApp() {
	initDb(":memory:");
	resetRateLimiters();
	return app;
}

export async function setupAdmin(
	testApp: typeof app,
	username = "admin",
	password = "password123",
) {
	const res = await testApp.request("/setup", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password }),
	});
	return (await res.json()) as { id: string; username: string; role: string };
}

export async function getToken(testApp: typeof app, username = "admin", password = "password123") {
	const res = await testApp.request("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password }),
	});
	// Extract JWT from the httpOnly cookie
	const setCookie = res.headers.get("set-cookie") ?? "";
	const match = setCookie.match(/yams_session=([^;]+)/);
	const token = match?.[1];
	if (!token) throw new Error("No session cookie in login response");
	return token;
}

/** Create a regular (non-admin) user via the admin user management API. Returns the created user's token. */
export async function createRegularUser(
	testApp: typeof app,
	adminToken: string,
	username = "user1",
	password = "password123",
): Promise<{ id: string; username: string; role: string; token: string }> {
	const res = await testApp.request("/api/users", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${adminToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ username, password, role: "user" }),
	});
	const body: { id: string; username: string; role: string } = await res.json();
	const token = await getToken(testApp, username, password);
	return { id: body.id, username: body.username, role: body.role, token };
}
