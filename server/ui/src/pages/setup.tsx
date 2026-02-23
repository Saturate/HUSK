import { ApiError, api } from "@/api";
import { AuthLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";

export function SetupPage() {
	const navigate = useNavigate();
	const [error, setError] = useState("");
	const [alreadyDone, setAlreadyDone] = useState(false);
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setError("");
		setLoading(true);

		const form = new FormData(e.currentTarget);
		const username = (form.get("username") as string).trim();
		const password = form.get("password") as string;

		try {
			await api.setup(username, password);
			navigate("/login?setup=success");
		} catch (err) {
			if (err instanceof ApiError && err.status === 403) {
				setAlreadyDone(true);
			} else if (err instanceof ApiError) {
				setError(err.message);
			} else {
				setError("Network error.");
			}
		} finally {
			setLoading(false);
		}
	}

	return (
		<AuthLayout title="YAMS Setup" description="Create the admin account to get started.">
			{alreadyDone ? (
				<div className="space-y-4">
					<p className="text-sm text-muted-foreground">Setup already completed.</p>
					<Button asChild className="w-full">
						<Link to="/login">Go to Login</Link>
					</Button>
				</div>
			) : (
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="username">Username</Label>
						<Input id="username" name="username" required minLength={3} autoComplete="username" />
					</div>
					<div className="space-y-2">
						<Label htmlFor="password">Password</Label>
						<Input
							id="password"
							name="password"
							type="password"
							required
							minLength={8}
							autoComplete="new-password"
						/>
					</div>
					{error && <p className="text-sm text-destructive-foreground">{error}</p>}
					<Button type="submit" className="w-full" disabled={loading}>
						{loading ? "Creating..." : "Create Admin"}
					</Button>
				</form>
			)}
		</AuthLayout>
	);
}
