import { api } from "@/api";
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
	login: () => void;
	logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		api
			.me()
			.then(() => setIsAuthenticated(true))
			.catch(() => setIsAuthenticated(false))
			.finally(() => setIsLoading(false));
	}, []);

	const login = useCallback(() => setIsAuthenticated(true), []);

	const logout = useCallback(() => {
		api.logout().catch(() => {});
		setIsAuthenticated(false);
	}, []);

	const value = useMemo(
		() => ({ isAuthenticated, isLoading, login, logout }),
		[isAuthenticated, isLoading, login, logout],
	);

	return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be used within AuthProvider");
	return ctx;
}
