"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useSession, signIn } from "next-auth/react";
import { ShieldCheck, ScanSearch, Lock, KeyRound, ExternalLink } from "lucide-react";
import { Navbar } from "./components/Navbar";
import { RegistryTable } from "./components/RegistryTable";
import { VaultBanner } from "./components/VaultBanner";
import { ClaimPanel } from "./components/ClaimPanel";
import type { ScanResult } from "@/lib/scan";

const STEPS = [
  {
    icon: <ScanSearch size={22} />,
    step: "01",
    title: "Detect",
    description: "A leaked private key or seed phrase turns up in a public repo, still holding funds.",
  },
  {
    icon: <Lock size={22} />,
    step: "02",
    title: "Shield",
    description: "The exposed balance is swept into the STRK20 shielded pool before an attacker can drain it. The holding position is unlinkable on-chain.",
  },
  {
    icon: <KeyRound size={22} />,
    step: "03",
    title: "Claim",
    description: "The owner signs in with the GitHub account that leaked the key, proving they control the repo, and gets the funds back in full.",
  },
];

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
    <div className="min-h-screen bg-white dark:bg-ls-black">
      <Navbar />
      <div className="pt-16">
        <VaultBanner
          rescuedCount={rescuedCount}
          rescuedTotal={rescuedTotal}
          rescuedCountMainnet={rescuedCountMainnet}
          rescuedTotalMainnet={rescuedTotalMainnet}
        />
      </div>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="pt-32 pb-20">
        <div className="section-container">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-2xl"
          >
            <div className="ls-badge mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              STRK20 Private Sprint
            </div>

            <h1 className="text-5xl lg:text-6xl font-bold text-black dark:text-white leading-tight tracking-tight mb-6">
              Whitehat rescue for{" "}
              <span style={{ color: "var(--pink)" }}>leaked keys</span>
            </h1>

            <p className="text-lg text-ls-gray-500 dark:text-ls-gray-400 leading-relaxed mb-10 max-w-xl">
              Aegis scans public repos for accidentally committed keys that
              control real funds, sweeps them into the STRK20 shielded pool
              before an attacker can, and returns them once you prove you
              own the repo.
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
              <a href="#registry" className="btn-ghost text-base px-8 py-3.5">
                See it in action →
              </a>
              <a
                href="https://github.com/justbiar/aegis"
                target="_blank"
                rel="noreferrer"
                className="btn-ghost text-base px-8 py-3.5"
              >
                <ExternalLink size={16} /> View source
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
          </motion.div>
        </div>
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 bg-ls-gray-50 dark:bg-ls-gray-900/40 border-y border-ls-gray-200 dark:border-ls-gray-800">
        <div className="section-container">
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-ls-gray-400 mb-3">
              How it works
            </p>
            <h2 className="text-3xl font-bold text-black dark:text-white">
              Three steps, no human in the loop
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {STEPS.map((s, i) => (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="ls-card"
              >
                <div className="w-10 h-10 rounded-xl bg-black dark:bg-white flex items-center justify-center
                  text-white dark:text-black mb-4">
                  {s.icon}
                </div>
                <p className="text-xs font-mono text-ls-gray-400 mb-1">{s.step}</p>
                <h3 className="font-bold text-black dark:text-white mb-2">{s.title}</h3>
                <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400 leading-relaxed">
                  {s.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY PRIVACY ─────────────────────────────────────────────────── */}
      <section className="bg-black dark:bg-ls-gray-950 py-24">
        <div className="section-container max-w-3xl">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
              <ShieldCheck size={16} className="text-black" />
            </div>
            <span className="text-white font-bold text-lg">Why it needs privacy</span>
          </div>
          <p className="text-xl lg:text-2xl font-medium text-white/90 leading-relaxed">
            A sweep-and-return service is only as safe as its own holding
            address. A transparent wallet is a target — anyone watching the
            mempool can front-run the rescue or drain it the moment it's
            known. Routing rescued funds through the STRK20 shielded pool
            removes that window: the holding balance isn't linkable
            on-chain, and payout to a verified owner is a private transfer,
            not a public, front-runnable one.
          </p>
        </div>
      </section>

      {/* ── REGISTRY SCAN ───────────────────────────────────────────────── */}
      <section id="registry" className="py-24">
        <div className="section-container">
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-ls-gray-400 mb-3">
              Coverage
            </p>
            <h2 className="text-3xl font-bold text-black dark:text-white mb-3">
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

      <ClaimPanel />

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <footer className="bg-black dark:bg-ls-gray-950 border-t border-ls-gray-900">
        <div className="section-container py-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center">
                <ShieldCheck size={14} className="text-black" />
              </div>
              <span className="text-white font-bold">Aegis</span>
            </div>
            <p className="text-white/40 text-xs">
              MIT License · Built for the STRK20 Private Sprint
            </p>
            <a
              href="https://github.com/justbiar/aegis"
              target="_blank"
              rel="noreferrer"
              className="text-white/60 text-sm hover:text-white transition-colors flex items-center gap-1.5"
            >
              <ExternalLink size={14} /> Repo
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
