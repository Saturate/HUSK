import { useAuth } from "@/auth-context";
import { Navigate, Outlet } from "react-router";

export function ProtectedRoute() {
	const { token } = useAuth();

	if (!token) {
		return <Navigate to="/login" replace />;
	}

	return <Outlet />;
}
