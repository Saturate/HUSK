import { AuthProvider } from "@/auth-context";
import { ProtectedRoute } from "@/components/protected-route";
import { KeysPage } from "@/pages/keys";
import { LoginPage } from "@/pages/login";
import { SetupPage } from "@/pages/setup";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

export function App() {
	return (
		<BrowserRouter>
			<AuthProvider>
				<Routes>
					<Route path="/setup" element={<SetupPage />} />
					<Route path="/login" element={<LoginPage />} />
					<Route element={<ProtectedRoute />}>
						<Route path="/keys" element={<KeysPage />} />
					</Route>
					<Route path="*" element={<Navigate to="/keys" replace />} />
				</Routes>
			</AuthProvider>
		</BrowserRouter>
	);
}
