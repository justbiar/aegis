"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

// Light/dark toggle. The initial class is set pre-paint by the inline script in
// layout.tsx (from localStorage, falling back to the OS preference); this just
// flips it and persists the choice.
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title="Toggle theme"
      className="inline-flex items-center justify-center w-9 h-9 rounded-2xl border border-ls-gray-200 dark:border-ls-gray-700
        text-ls-gray-600 dark:text-ls-gray-300 hover:text-black dark:hover:text-white
        hover:bg-ls-gray-50 dark:hover:bg-ls-gray-900 transition-colors"
    >
      {/* Render a stable icon until mounted to avoid hydration mismatch. */}
      {mounted && dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
