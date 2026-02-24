/** Random backronyms for YAMS, shown on each page load */
const BACKRONYMS = [
	"Yet Another Memory System",
	"Your AI Memory Store",
	"Yesterday's Answers Made Searchable",
	"You Actually Memorized Stuff",
	"Your Aging Mind's Savior",
	"You Already Mentioned Something",
	"Your Assistant Memorizes Sessions",
	"Yoink All My Snippets",
	"Yesterday Already? Memory's Short",
	"Your AI Manages State",
	"Yelling At My Servers",
	"You Ask, Memory Serves",
	"Your Absolutely Magnificent Secretary",
	"Yams Are My Snack",
	"Your Anthropic Memory Service",
];

export function randomBackronym(): string {
	const index = Math.floor(Math.random() * BACKRONYMS.length);
	return BACKRONYMS[index] ?? BACKRONYMS[0] ?? "Yet Another Memory System";
}
