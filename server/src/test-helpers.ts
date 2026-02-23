import { app } from "./app.js";
import { initDb } from "./db.js";

export function createTestApp() {
	initDb(":memory:");
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
	return res.json<{ id: string; username: string }>();
}

export async function getToken(testApp: typeof app, username = "admin", password = "password123") {
	const res = await testApp.request("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username, password }),
	});
	const data = await res.json<{ token: string }>();
	return data.token;
}
