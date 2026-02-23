import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 365 * 24 * 60 * 60 * 1000],
	["month", 30 * 24 * 60 * 60 * 1000],
	["week", 7 * 24 * 60 * 60 * 1000],
	["day", 24 * 60 * 60 * 1000],
	["hour", 60 * 60 * 1000],
	["minute", 60 * 1000],
	["second", 1000],
];

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(date: string | null): string {
	if (!date) return "Never";
	const diff = new Date(date).getTime() - Date.now();
	for (const [unit, ms] of UNITS) {
		if (Math.abs(diff) >= ms) {
			return rtf.format(Math.round(diff / ms), unit);
		}
	}
	return rtf.format(0, "second");
}
