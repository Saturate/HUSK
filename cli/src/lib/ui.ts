import * as p from "@clack/prompts";

declare const __HUSK_VERSION__: string;
export const VERSION = typeof __HUSK_VERSION__ !== "undefined" ? __HUSK_VERSION__ : "dev";

export function isInteractive(): boolean {
	return process.stdin.isTTY === true;
}

export function banner() {
	console.log();
	p.intro(`HUSK v${VERSION} — Memory layer for AI coding assistants`);
}

export function handleCancel(value: unknown): asserts value is Exclude<
	typeof value,
	symbol
> {
	if (p.isCancel(value)) {
		p.cancel("Cancelled.");
		process.exit(0);
	}
}

export async function withSpinner<T>(
	message: string,
	fn: () => Promise<T>,
): Promise<T> {
	const s = p.spinner();
	s.start(message);
	try {
		const result = await fn();
		s.stop(message);
		return result;
	} catch (error) {
		s.stop(`Failed: ${message}`);
		throw error;
	}
}
