export function HuskLogo({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 64 64"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
			aria-label="HUSK logo"
		>
			<rect width="64" height="64" rx="14" fill="currentColor" fillOpacity={0.1} />
			<text
				x="32"
				y="40"
				textAnchor="middle"
				fontFamily="system-ui, sans-serif"
				fontWeight="700"
				fontSize="24"
				fill="currentColor"
			>
				H
			</text>
		</svg>
	);
}
