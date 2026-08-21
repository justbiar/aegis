"use client";

import { useState, useEffect } from "react";
import { Shield, Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import SelectWallet from "./client/WalletHandle/SelectWallet";
import ConnectGithub from "./client/GithubHandle/ConnectGithub";

const NAV_LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Coverage", href: "#registry" },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 bg-white dark:bg-ls-black
        ${scrolled
          ? "border-b border-ls-gray-200 dark:border-ls-gray-800 shadow-sm"
          : "border-b border-transparent"
        }`}
    >
      <div className="section-container h-16 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 bg-black dark:bg-white rounded-lg">
            <Shield size={16} className="text-white dark:text-black" />
          </div>
          <span className="font-display font-semibold text-lg tracking-tight text-black dark:text-white">
            Aegis
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="px-4 py-2 text-sm font-medium text-ls-gray-600 dark:text-ls-gray-400
                hover:text-black dark:hover:text-white transition-colors duration-150 rounded-lg
                hover:bg-ls-gray-50 dark:hover:bg-ls-gray-900"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <ConnectGithub />
          <SelectWallet variant="nav" />
        </div>

        <button
          className="md:hidden p-2 text-ls-gray-600 dark:text-ls-gray-400 hover:text-black dark:hover:text-white"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav-menu"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            id="mobile-nav-menu"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden border-t border-ls-gray-200 dark:border-ls-gray-800 bg-white dark:bg-ls-black overflow-hidden"
          >
            <div className="section-container py-4 flex flex-col gap-1">
              {NAV_LINKS.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  onClick={() => setMobileOpen(false)}
                  className="px-4 py-2.5 text-sm font-medium text-ls-gray-600 dark:text-ls-gray-400
                    hover:text-black dark:hover:text-white hover:bg-ls-gray-50 dark:hover:bg-ls-gray-900
                    rounded-lg transition-colors"
                >
                  {l.label}
                </a>
              ))}
              <div className="pt-3 border-t border-ls-gray-200 dark:border-ls-gray-800 flex flex-col gap-2 items-start">
                <ConnectGithub />
                <SelectWallet variant="nav" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
