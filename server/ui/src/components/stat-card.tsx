import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
	label,
	value,
	subtitle,
}: {
	label: string;
	value: string;
	subtitle?: string;
}) {
	return (
		<Card>
			<CardContent className="pt-6">
				<p className="text-sm text-muted-foreground">{label}</p>
				<p className="mt-1 text-2xl font-semibold">{value}</p>
				{subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
			</CardContent>
		</Card>
	);
}
