import { docs } from "@/.source";
import { loader } from "fumadocs-core/source";
import { createMDXSource } from "fumadocs-mdx";

const mdxSource = createMDXSource(docs.docs, docs.meta);

// fumadocs-mdx v11 types say files is an array but runtime returns a function.
// Eagerly resolve it for fumadocs-core v16 loader which iterates files directly.
const files = (mdxSource.files as unknown as () => typeof mdxSource.files)();

export const source = loader({
	baseUrl: "/docs",
	source: { files },
});
