import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

interface AuthContextValue {
	token: string | null;
	login: (token: string) => void;
	logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [token, setToken] = useState<string | null>(null);

	const login = useCallback((t: string) => setToken(t), []);
	const logout = useCallback(() => setToken(null), []);

	const value = useMemo(() => ({ token, login, logout }), [token, login, logout]);

	return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be used within AuthProvider");
	return ctx;
}
