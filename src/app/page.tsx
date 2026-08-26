"use client";

import { useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { KeyRound, ExternalLink } from "lucide-react";
import { Navbar } from "./components/Navbar";
import { VaultHero } from "./components/VaultHero";
import { RegistryTable } from "./components/RegistryTable";
import { ScanYourRepo } from "./components/ScanYourRepo";
import { VaultBanner } from "./components/VaultBanner";
import { ClaimPanel } from "./components/ClaimPanel";
import { LiveConsole } from "./components/LiveConsole";
import type { ScanResult } from "@/lib/scan";

export default function Page() {
  const { status: authStatus } = useSession();
  const [rescuedCount, setRescuedCount] = useState(0);
  const [rescuedTotal, setRescuedTotal] = useState(0);
  const [rescuedCountMainnet, setRescuedCountMainnet] = useState(0);
  const [rescuedTotalMainnet, setRescuedTotalMainnet] = useState(0);

  const handleScanResults = (results: ScanResult[]) => {
    let count = 0;
    let total = 0;
    let countMainnet = 0;
    let totalMainnet = 0;
    for (const r of results) {
      const rescued = r.findings.filter((f) => f.rescueTxHash);
      for (const f of rescued) {
        if (f.network === "mainnet") {
          countMainnet++;
          totalMainnet += f.rescueAmount ?? 0;
        } else {
          count++;
          total += f.rescueAmount ?? 0;
        }
      }
    }
    setRescuedCount(count);
    setRescuedTotal(total);
    setRescuedCountMainnet(countMainnet);
    setRescuedTotalMainnet(totalMainnet);
  };

  return (
    <div className="min-h-screen">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      {/* ── CINEMATIC VAULT INTRO (one-shot overlay). Everything below —
             navbar, main, footer — lives in #site-shell, which VaultHero
             depth-scales as a single unit so the whole site (not just <main>)
             emerges together from inside the vault. ───────────────────────── */}
      <VaultHero />
      <div id="site-shell">
      <Navbar />
      <main id="main-content">
      {/* ── HERO (text) ─────────────────────────────────────────────────── */}
      <section className="relative pt-28 pb-16">
        <div className="ambient-glow" aria-hidden />
        <div className="section-container">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 mb-7">
              <div className="ls-badge">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                STRK20 Private Sprint
              </div>
              <span className="spectrum-bar h-1 w-14 inline-block" aria-hidden />
            </div>
            <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-semibold text-black dark:text-white leading-[0.95] tracking-tight mb-6">
              Whitehat rescue for{" "}
              <span className="font-serif font-normal italic tracking-tight" style={{ color: "var(--ink)" }}>
                leaked keys
              </span>
            </h1>
            <p className="text-lg text-ls-gray-500 dark:text-ls-gray-400 leading-relaxed mb-9 max-w-xl">
              Aegis scans public repos for accidentally committed keys that
              control real funds, sweeps them into the STRK20 shielded pool
              before an attacker can, and returns them once you prove you own
              the repo.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              {authStatus === "authenticated" ? (
                <a href="#claim" className="btn-primary text-base px-8 py-3.5">
                  <KeyRound size={16} /> Check your claim
                </a>
              ) : (
                <button
                  onClick={() => signIn("github")}
                  disabled={authStatus === "loading"}
                  className="btn-primary text-base px-8 py-3.5 disabled:opacity-50"
                >
                  <KeyRound size={16} /> Connect GitHub
                </button>
              )}
              <a href="#live" className="btn-ghost text-base px-8 py-3.5">
                See it live →
              </a>
              <a
                href="https://github.com/justbiar/aegis"
                target="_blank"
                rel="noreferrer"
                className="link-arrow text-sm text-ls-gray-500 dark:text-ls-gray-400 hover:text-black dark:hover:text-white ml-1"
              >
                <ExternalLink size={15} /> View source
              </a>
            </div>
            <div className="flex items-center gap-8 mt-12 pt-8 ls-divider">
              {[
                { label: "Network", value: "Starknet" },
                { label: "Privacy layer", value: "STRK20 pool" },
                { label: "License", value: "MIT" },
              ].map((t) => (
                <div key={t.label}>
                  <p className="text-xs text-ls-gray-400">{t.label}</p>
                  <p className="text-sm font-semibold text-black dark:text-white">{t.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── LIVE CONSOLE (vault balances folded in) ─────────────────────── */}
      <section id="live" className="pt-12 pb-20">
        <div className="section-container">
          <LiveConsole
            embedded
            vaultBanner={
              <VaultBanner
                variant="panel"
                rescuedCount={rescuedCount}
                rescuedTotal={rescuedTotal}
                rescuedCountMainnet={rescuedCountMainnet}
                rescuedTotalMainnet={rescuedTotalMainnet}
              />
            }
          />

          <div className="text-center mt-10">
            <p className="eyebrow">Live</p>
            <h2 className="font-display text-3xl lg:text-4xl font-semibold text-black dark:text-white tracking-tight mb-3">
              The agent, running right now
            </h2>
            <p className="text-ls-gray-500 dark:text-ls-gray-400 max-w-xl mx-auto">
              Every registered repo, scanned continuously — funds flow privately into the shielded vault.{" "}
              <a href="/console" className="link-arrow">Open the full console →</a>
            </p>
          </div>
        </div>
      </section>

      <ScanYourRepo />

      <ClaimPanel />

      {/* ── REGISTRY SCAN ───────────────────────────────────────────────── */}
      <section id="registry" className="py-24">
        <div className="section-container">
          <div className="text-center mb-12">
            <p className="eyebrow">
              Coverage
            </p>
            <h2 className="font-display text-3xl lg:text-4xl font-semibold text-black dark:text-white tracking-tight mb-3">
              Watching the sprint's own registry
            </h2>
            <p className="text-ls-gray-500 dark:text-ls-gray-400 max-w-xl mx-auto">
              Every project that registers for the STRK20 Private Sprint gets
              scanned — fellow builders shipping fast are exactly who leaks a
              key by accident.
            </p>
          </div>
          <RegistryTable onResults={handleScanResults} />
        </div>
      </section>
      </main>

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-ls-gray-200 dark:border-ls-gray-800">
        <div className="section-container py-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Aegis" className="w-7 h-7 rounded-lg border border-ls-gray-200 dark:border-ls-gray-800" />
              <span className="font-bold text-black dark:text-white">Aegis</span>
            </div>
            <p className="text-ls-gray-500 text-xs">
              MIT License · Built for the STRK20 Private Sprint
            </p>
            <div className="flex items-center gap-5">
              <a
                href="https://github.com/justbiar/aegis/blob/main/docs/FINDINGS.md"
                target="_blank"
                rel="noreferrer"
                className="text-ls-gray-500 text-sm hover:text-black dark:hover:text-white transition-colors flex items-center gap-1.5"
              >
                <ExternalLink size={14} /> Field notes
              </a>
              <a
                href="https://github.com/justbiar/aegis"
                target="_blank"
                rel="noreferrer"
                className="text-ls-gray-500 text-sm hover:text-black dark:hover:text-white transition-colors flex items-center gap-1.5"
              >
                <ExternalLink size={14} /> Repo
              </a>
            </div>
          </div>
        </div>
      </footer>
      </div>
    </div>
  );
}
