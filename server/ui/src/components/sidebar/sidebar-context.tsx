import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

interface SidebarContextValue {
	isOpen: boolean;
	isMobile: boolean;
	toggle: () => void;
	close: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

const STORAGE_KEY = "husk_sidebar";
const MOBILE_BREAKPOINT = 768;

export function SidebarProvider({ children }: { children: ReactNode }) {
	const [isMobile, setIsMobile] = useState(false);
	const [isOpen, setIsOpen] = useState(() => {
		if (typeof window === "undefined") return true;
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored !== "collapsed";
	});

	useEffect(() => {
		const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
		const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
			setIsMobile(e.matches);
			if (e.matches) setIsOpen(false);
		};
		onChange(mql);
		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	}, []);

	const toggle = useCallback(() => {
		setIsOpen((prev) => {
			const next = !prev;
			if (!isMobile) localStorage.setItem(STORAGE_KEY, next ? "expanded" : "collapsed");
			return next;
		});
	}, [isMobile]);

	const close = useCallback(() => {
		setIsOpen(false);
		if (!isMobile) localStorage.setItem(STORAGE_KEY, "collapsed");
	}, [isMobile]);

	const value = useMemo(() => ({ isOpen, isMobile, toggle, close }), [isOpen, isMobile, toggle, close]);

	return <SidebarContext value={value}>{children}</SidebarContext>;
}

export function useSidebar(): SidebarContextValue {
	const ctx = useContext(SidebarContext);
	if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
	return ctx;
}
