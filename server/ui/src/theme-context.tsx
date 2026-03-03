import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_THEME, type ThemeDefinition, getTheme, themes } from "./themes";

const STORAGE_KEY = "husk_theme";

interface ThemeContextValue {
	theme: ThemeDefinition;
	setTheme: (id: string) => void;
	themes: ThemeDefinition[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function loadFonts(theme: ThemeDefinition) {
	for (const el of document.querySelectorAll("link[data-husk-fonts]")) {
		el.remove();
	}

	if (theme.googleFonts.length === 0) return;

	const families = theme.googleFonts.join("&family=");
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`;
	link.setAttribute("data-husk-fonts", theme.id);
	document.head.appendChild(link);
}

/** Apply CSS variables directly on the root element's style attribute */
function applyThemeVariables(theme: ThemeDefinition) {
	const root = document.documentElement;
	const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	const vars = isDark ? theme.dark : theme.light;

	// Build a single style string with all variables
	const style = Object.entries(vars)
		.map(([key, value]) => `--${key}: ${value}`)
		.join("; ");

	root.setAttribute("style", style);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [themeId, setThemeId] = useState(() => {
		try {
			return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME;
		} catch {
			return DEFAULT_THEME;
		}
	});

	const theme = getTheme(themeId);

	useEffect(() => {
		loadFonts(theme);
		applyThemeVariables(theme);

		// Re-apply when OS color scheme changes
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = () => applyThemeVariables(theme);
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, [theme]);

	const setTheme = useCallback((id: string) => {
		setThemeId(id);
		try {
			localStorage.setItem(STORAGE_KEY, id);
		} catch {
			// localStorage unavailable
		}
	}, []);

	return <ThemeContext value={{ theme, setTheme, themes }}>{children}</ThemeContext>;
}

export function useTheme() {
	const ctx = useContext(ThemeContext);
	if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
	return ctx;
}
