import { api } from "@/api";
import type { UserRole } from "@/api";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

interface AuthContextValue {
	isAuthenticated: boolean;
	isLoading: boolean;
	username: string | null;
	role: UserRole | null;
	isAdmin: boolean;
	login: (username?: string, role?: UserRole) => void;
	logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [username, setUsername] = useState<string | null>(null);
	const [role, setRole] = useState<UserRole | null>(null);

	useEffect(() => {
		api
			.me()
			.then((data) => {
				setIsAuthenticated(true);
				setUsername(data.username);
				setRole(data.role ?? "user");
			})
			.catch(() => setIsAuthenticated(false))
			.finally(() => setIsLoading(false));
	}, []);

	const login = useCallback((u?: string, r?: UserRole) => {
		setIsAuthenticated(true);
		if (u) setUsername(u);
		if (r) setRole(r);
	}, []);

	const logout = useCallback(() => {
		api.logout().catch(() => {});
		setIsAuthenticated(false);
		setUsername(null);
		setRole(null);
	}, []);

	const isAdmin = role === "admin";

	const value = useMemo(
		() => ({ isAuthenticated, isLoading, username, role, isAdmin, login, logout }),
		[isAuthenticated, isLoading, username, role, isAdmin, login, logout],
	);

	return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be used within AuthProvider");
	return ctx;
}
