import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

export default defineConfig({
	entry: ["src/bin.ts"],
	format: "esm",
	target: "node18",
	platform: "node",
	clean: true,
	// Bundle all deps into a single file so `npx husk` works without node_modules
	noExternal: [/.*/],
	banner: {
		js: "#!/usr/bin/env node",
	},
	define: {
		__HUSK_VERSION__: JSON.stringify(pkg.version),
	},
});
