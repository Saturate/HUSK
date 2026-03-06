import { defineConfig } from "tsup";

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
});
