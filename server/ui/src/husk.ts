/** Random backronyms for HUSK, shown on each page load */
const BACKRONYMS = [
	"Helpful Universal Storage for Knowledge",
	"Handy Utility for Saving Knowledge",
	"How U Store Knowledge",
	"Histories, Updates, Sessions, Knowledge",
	"Hardly Used Storage for Knowledge",
	"Has Uncanny Semantic Knowledge",
	"Hyper-fast Universal Semantic Knowledge",
	"Hey, U Saved Knowledge",
	"Humans Usually Seek Knowledge",
	"Hoarding Useful Stuff for Knowledge",
	"Helpfully Unforgetting Saved Knowledge",
	"Huge Unstructured Semantic Knowledgebase",
	"Hark! Useful Saved Knowledge",
	"Hej, U Stored Knowledge",
];

export function randomBackronym(): string {
	const index = Math.floor(Math.random() * BACKRONYMS.length);
	return BACKRONYMS[index] ?? BACKRONYMS[0] ?? "Helpful Universal Storage for Knowledge";
}
