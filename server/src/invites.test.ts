import { describe, expect, test } from "bun:test";
import { createTestApp, getToken, setupAdmin } from "./test-helpers.js";

describe("invites", () => {
	test("admin can create an invite", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const token = await getToken(app);

		const res = await app.request("/api/invites", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ email: "alice@example.com" }),
		});
		expect(res.status).toBe(201);
		const body: { id: string; email: string; role: string; token: string; invite_url: string } =
			await res.json();
		expect(body.email).toBe("alice@example.com");
		expect(body.role).toBe("user");
		expect(body.token).toBeDefined();
		expect(body.invite_url).toContain("/invite/");
	});

	test("admin can list invites", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const token = await getToken(app);

		await app.request("/api/invites", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ email: "bob@example.com" }),
		});

		const res = await app.request("/api/invites", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body: Array<{ email: string }> = await res.json();
		expect(body).toHaveLength(1);
		expect(body[0]?.email).toBe("bob@example.com");
	});

	test("invite can be validated", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const token = await getToken(app);

		const createRes = await app.request("/api/invites", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ email: "carol@example.com" }),
		});
		const { token: inviteToken }: { token: string } = await createRes.json();

		const res = await app.request(`/api/invites/${inviteToken}/validate`);
		expect(res.status).toBe(200);
		const body: { email: string; role: string } = await res.json();
		expect(body.email).toBe("carol@example.com");
		expect(body.role).toBe("user");
	});

	test("invite can be accepted", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const adminToken = await getToken(app);

		const createRes = await app.request("/api/invites", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${adminToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ email: "dave@example.com" }),
		});
		const { token: inviteToken }: { token: string } = await createRes.json();

		const acceptRes = await app.request(`/api/invites/${inviteToken}/accept`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "dave", password: "password123" }),
		});
		expect(acceptRes.status).toBe(201);
		const body: { username: string; role: string } = await acceptRes.json();
		expect(body.username).toBe("dave");
		expect(body.role).toBe("user");

		// Session cookie should be set
		const cookie = acceptRes.headers.get("set-cookie") ?? "";
		expect(cookie).toContain("husk_session=");
	});

	test("invite cannot be used twice", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const adminToken = await getToken(app);

		const createRes = await app.request("/api/invites", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${adminToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ email: "eve@example.com" }),
		});
		const { token: inviteToken }: { token: string } = await createRes.json();

		// First accept
		await app.request(`/api/invites/${inviteToken}/accept`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "eve", password: "password123" }),
		});

		// Second accept should fail
		const res = await app.request(`/api/invites/${inviteToken}/accept`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "eve2", password: "password123" }),
		});
		expect(res.status).toBe(410);
	});

	test("invalid invite token returns 404", async () => {
		const app = createTestApp();
		await setupAdmin(app);

		const res = await app.request("/api/invites/bogus-token/validate");
		expect(res.status).toBe(404);
	});

	test("admin can delete an invite", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const token = await getToken(app);

		const createRes = await app.request("/api/invites", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ email: "frank@example.com" }),
		});
		const { id }: { id: string } = await createRes.json();

		const res = await app.request(`/api/invites/${id}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
	});

	test("rejects invalid email", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const token = await getToken(app);

		const res = await app.request("/api/invites", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ email: "not-an-email" }),
		});
		expect(res.status).toBe(400);
	});

	test("invite with admin role creates admin user", async () => {
		const app = createTestApp();
		await setupAdmin(app);
		const adminToken = await getToken(app);

		const createRes = await app.request("/api/invites", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${adminToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ email: "grace@example.com", role: "admin" }),
		});
		const { token: inviteToken }: { token: string } = await createRes.json();

		const acceptRes = await app.request(`/api/invites/${inviteToken}/accept`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "grace", password: "password123" }),
		});
		expect(acceptRes.status).toBe(201);
		const body: { role: string } = await acceptRes.json();
		expect(body.role).toBe("admin");
	});
});
