"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Navbar } from "./components/Navbar";
import { VaultHero } from "./components/VaultHero";
import { RegistryTable } from "./components/RegistryTable";
import { VaultBanner } from "./components/VaultBanner";
import { ClaimPanel } from "./components/ClaimPanel";
import { LiveConsole } from "./components/LiveConsole";
import type { ScanResult } from "@/lib/scan";

export default function Page() {
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
      <Navbar />
      <main id="main-content">
      {/* ── CINEMATIC VAULT HERO (scroll-driven, full screen) ───────────── */}
      <VaultHero />

      {/* ── LIVE CONSOLE + VAULT ────────────────────────────────────────── */}
      <section id="live" className="pt-12 pb-20">
        <VaultBanner
          rescuedCount={rescuedCount}
          rescuedTotal={rescuedTotal}
          rescuedCountMainnet={rescuedCountMainnet}
          rescuedTotalMainnet={rescuedTotalMainnet}
        />

        <div className="section-container mt-12">
          <LiveConsole embedded />

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
      </footer>
    </div>
  );
}
