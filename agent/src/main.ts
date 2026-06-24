import { dispatch } from "./dispatcher.js";

async function main() {
	// Read all stdin
	const chunks: Buffer[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(Buffer.from(chunk));
	}
	const raw = Buffer.concat(chunks).toString("utf-8").trim();
	if (!raw) process.exit(0);

	let input: Record<string, unknown>;
	try {
		input = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		process.exit(0);
	}

	const result = await dispatch(input);

	// Write hookSpecificOutput to stdout if handler produced one
	if (result) {
		process.stdout.write(JSON.stringify(result));
	}
}

main().catch(() => process.exit(0));
