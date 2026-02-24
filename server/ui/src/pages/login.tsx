import { ApiError, api } from "@/api";
import { useAuth } from "@/auth-context";
import { AuthLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { randomBackronym } from "@/yams";
import { type FormEvent, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

export function LoginPage() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const { login } = useAuth();
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const showSetupSuccess = searchParams.get("setup") === "success";
	const acronym = useMemo(() => randomBackronym(), []);

	async function handleSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setError("");
		setLoading(true);

		const form = new FormData(e.currentTarget);
		const username = (form.get("username") as string).trim();
		const password = form.get("password") as string;

		try {
			await api.login(username, password);
			login();
			navigate("/dashboard");
		} catch (err) {
			if (err instanceof ApiError) {
				setError(err.message);
			} else {
				setError("Network error.");
			}
		} finally {
			setLoading(false);
		}
	}

	return (
		<AuthLayout title="YAMS" description={acronym}>
			{showSetupSuccess && (
				<div className="mb-4 rounded-md border border-green-800 bg-green-950 px-3 py-2 text-sm text-green-400">
					Admin account created. Sign in to continue.
				</div>
			)}
			<form onSubmit={handleSubmit} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="username">Username</Label>
					<Input id="username" name="username" required autoComplete="username" />
				</div>
				<div className="space-y-2">
					<Label htmlFor="password">Password</Label>
					<Input
						id="password"
						name="password"
						type="password"
						required
						autoComplete="current-password"
					/>
				</div>
				{error && <p className="text-sm text-destructive-foreground">{error}</p>}
				<Button type="submit" className="w-full" disabled={loading}>
					{loading ? "Signing in..." : "Sign in"}
				</Button>
			</form>
		</AuthLayout>
	);
}
