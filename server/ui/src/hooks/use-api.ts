import { AuthError, SetupRequiredError } from "@/api";
import { useAuth } from "@/auth-context";
import { useCallback } from "react";
import { useNavigate } from "react-router";

export function useApi() {
	const { token, logout } = useAuth();
	const navigate = useNavigate();

	const call = useCallback(
		async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
			if (!token) {
				navigate("/login");
				throw new AuthError();
			}
			try {
				return await fn(token);
			} catch (err) {
				if (err instanceof AuthError) {
					logout();
					navigate("/login");
				} else if (err instanceof SetupRequiredError) {
					navigate("/setup");
				}
				throw err;
			}
		},
		[token, logout, navigate],
	);

	return { call, token };
}
