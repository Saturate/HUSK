export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

export class AuthError extends ApiError {
	constructor(message = "Authorization required.") {
		super(401, message);
	}
}

export class SetupRequiredError extends ApiError {
	constructor() {
		super(503, "Server not configured.");
	}
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const res = await fetch(path, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...options.headers,
		},
	});

	if (res.status === 401) throw new AuthError();
	if (res.status === 503) throw new SetupRequiredError();

	const data = await res.json();

	if (!res.ok) {
		throw new ApiError(res.status, data.error ?? "Something went wrong.");
	}

	return data as T;
}

export interface SetupResponse {
	id: string;
	username: string;
}

export interface LoginResponse {
	token: string;
}

export interface ApiKey {
	id: string;
	label: string;
	key_prefix: string;
	is_active: boolean;
	expires_at: string | null;
	created_at: string;
	last_used_at: string | null;
}

export interface CreateKeyResponse {
	id: string;
	key: string;
	label: string;
	key_prefix: string;
	expires_at: string | null;
}

export const api = {
	setup(username: string, password: string) {
		return request<SetupResponse>("/setup", {
			method: "POST",
			body: JSON.stringify({ username, password }),
		});
	},

	login(username: string, password: string) {
		return request<LoginResponse>("/api/auth/login", {
			method: "POST",
			body: JSON.stringify({ username, password }),
		});
	},

	listKeys(token: string) {
		return request<ApiKey[]>("/api/keys", {
			headers: { Authorization: `Bearer ${token}` },
		});
	},

	createKey(token: string, label: string, expiresInDays?: number) {
		const body: { label: string; expires_in?: number } = { label };
		if (expiresInDays != null) {
			body.expires_in = expiresInDays * 86400;
		}
		return request<CreateKeyResponse>("/api/keys", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify(body),
		});
	},

	revokeKey(token: string, id: string) {
		return request<{ id: string; revoked: true }>(`/api/keys/${encodeURIComponent(id)}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
	},
};
