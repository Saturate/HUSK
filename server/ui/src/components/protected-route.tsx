import { useAuth } from "@/auth-context";
import { Navigate, Outlet } from "react-router";

export function ProtectedRoute() {
	const { isAuthenticated, isLoading } = useAuth();

	if (isLoading) return null;

	if (!isAuthenticated) {
		return <Navigate to="/login" replace />;
	}

	return <Outlet />;
}
