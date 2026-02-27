import { describe, expect, test } from "bun:test";
import { createRegularUser, createTestApp, getToken, setupAdmin } from "./test-helpers.js";

describe("user management", () => {
	test("setup creates admin role", async () => {
		const app = createTestApp();
		const result = await setupAdmin(app);
		expect(result.role).toBe("admin");
	});

	test("/me returns role", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const token = await getToken(app);

		const res = await app.request("/api/auth/me", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { username: string; role: string };
		expect(body.role).toBe("admin");
	});

	test("login returns role", async () => {
		const app = createTestApp();
		await setupAdmin(app);

		const res = await app.request("/api/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "admin", password: "password123" }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { username: string; role: string };
		expect(body.role).toBe("admin");
	});

	test("admin can create a user", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const token = await getToken(app);

		const res = await app.request("/api/users", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ username: "alice", password: "password123", role: "user" }),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { id: string; username: string; role: string };
		expect(body.username).toBe("alice");
		expect(body.role).toBe("user");
	});

	test("admin can list users", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const token = await getToken(app);

		// Create a second user
		await app.request("/api/users", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ username: "bob", password: "password123" }),
		});

		const res = await app.request("/api/users", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as Array<{ username: string; role: string }>;
		expect(body).toHaveLength(2);
		expect(body.map((u) => u.username)).toContain("admin");
		expect(body.map((u) => u.username)).toContain("bob");
	});

	test("admin can delete a user", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const token = await getToken(app);

		const createRes = await app.request("/api/users", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ username: "toDelete", password: "password123" }),
		});
		const { id } = (await createRes.json()) as { id: string };

		const res = await app.request(`/api/users/${id}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { id: string; deleted: boolean };
		expect(body.deleted).toBe(true);
	});

	test("admin cannot delete self", async () => {
		const app = createTestApp();
		const { id } = await setupAdmin(app);
		const token = await getToken(app);

		const res = await app.request(`/api/users/${id}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(400);
	});

	test("rejects duplicate username", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const token = await getToken(app);

		await app.request("/api/users", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ username: "alice", password: "password123" }),
		});

		const res = await app.request("/api/users", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ username: "alice", password: "password456" }),
		});
		expect(res.status).toBe(409);
	});

	test("rejects invalid role", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const token = await getToken(app);

		const res = await app.request("/api/users", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ username: "alice", password: "password123", role: "superadmin" }),
		});
		expect(res.status).toBe(400);
	});

	test("regular user cannot access user management", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const adminToken = await getToken(app);
		const user = await createRegularUser(app, adminToken);

		// GET /api/users
		const listRes = await app.request("/api/users", {
			headers: { Authorization: `Bearer ${user.token}` },
		});
		expect(listRes.status).toBe(403);

		// POST /api/users
		const createRes = await app.request("/api/users", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${user.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ username: "hacker", password: "password123" }),
		});
		expect(createRes.status).toBe(403);
	});

	test("regular user /me returns user role", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const adminToken = await getToken(app);
		const user = await createRegularUser(app, adminToken);

		const res = await app.request("/api/auth/me", {
			headers: { Authorization: `Bearer ${user.token}` },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { role: string };
		expect(body.role).toBe("user");
	});

	test("GET /api/auth/providers returns provider status", async () => {
		const app = createTestApp();
		await setupAdmin(app);

		const res = await app.request("/api/auth/providers");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { github: boolean };
		// GitHub OAuth is not configured in test env
		expect(body.github).toBe(false);
	});
});
