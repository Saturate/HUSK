import { docs } from "@/.source";
import { loader } from "fumadocs-core/source";
import { createMDXSource, resolveFiles } from "fumadocs-mdx";

export const source = loader({
	baseUrl: "/docs",
	source: { files: resolveFiles({ docs: docs.docs, meta: docs.meta }) },
});
