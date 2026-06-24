import { api } from "@/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { relativeTime } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

export function RecentMemoriesCard() {
	const { data, isLoading } = useQuery({
		queryKey: ["memories", "recent"],
		queryFn: () => api.listMemories({ limit: 5 }),
	});

	const memories = data?.memories ?? [];

	if (isLoading) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Recent Memories</CardTitle>
				<CardDescription>Last 5 memories stored across all projects.</CardDescription>
			</CardHeader>
			<CardContent>
				{memories.length === 0 ? (
					<p className="py-4 text-center text-sm text-muted-foreground">No memories yet.</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Summary</TableHead>
								<TableHead>Project</TableHead>
								<TableHead>Scope</TableHead>
								<TableHead>Created</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{memories.map((m) => (
								<TableRow key={m.id}>
									<TableCell className="max-w-xs truncate font-medium">
										{m.summary}
									</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{m.git_remote ?? "—"}
									</TableCell>
									<TableCell className="text-sm">{m.scope}</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{relativeTime(m.created_at)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
