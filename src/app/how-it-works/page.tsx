"use client";

import { motion } from "framer-motion";
import { ScanSearch, Lock, KeyRound, ShieldCheck, ExternalLink } from "lucide-react";
import { Navbar } from "../components/Navbar";

const STEPS = [
  {
    icon: <ScanSearch size={22} />,
    step: "01",
    title: "Detect",
    description:
      "A leaked private key or seed phrase turns up in a public repo, still holding funds. Aegis scans the sprint registry continuously and derives the on-chain address from the key itself.",
  },
  {
    icon: <Lock size={22} />,
    step: "02",
    title: "Shield",
    description:
      "The exposed balance is swept into the STRK20 shielded pool before an attacker can drain it. The holding position is unlinkable on-chain — nothing to front-run.",
  },
  {
    icon: <KeyRound size={22} />,
    step: "03",
    title: "Claim",
    description:
      "The owner signs in with the GitHub account that leaked the key, proving they control the repo, picks where the funds go, and gets them back as a private transfer.",
  },
];

export default function HowItWorks() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="pt-16">
        <section className="py-24">
          <div className="section-container">
            <div className="max-w-2xl mb-14">
              <p className="eyebrow">How it works</p>
              <h1 className="font-display text-4xl lg:text-6xl font-semibold text-black dark:text-white tracking-tight leading-[1.05] mb-5">
                Three steps, no{" "}
                <span className="font-serif font-normal italic" style={{ color: "var(--ink)" }}>
                  human in the loop
                </span>
              </h1>
              <p className="text-lg text-ls-gray-500 dark:text-ls-gray-400 leading-relaxed">
                Detection, rescue and return run on their own. The only human step is the owner proving,
                through GitHub, that the repo is theirs.
              </p>
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
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                    style={{ background: "var(--graphite)", color: "var(--on-graphite)" }}
                  >
                    {s.icon}
                  </div>
                  <p className="text-xs font-mono text-ls-gray-400 mb-1">{s.step}</p>
                  <h3 className="font-bold text-black dark:text-white mb-2">{s.title}</h3>
                  <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400 leading-relaxed">{s.description}</p>
                </motion.div>
              ))}
            </div>

            <div className="mt-12 flex flex-wrap items-center gap-4">
              <a href="/#claim" className="btn-primary text-base px-8 py-3.5">
                <KeyRound size={16} /> Check your claim
              </a>
              <a href="/console" className="btn-ghost text-base px-8 py-3.5">
                See it live →
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-ls-gray-200 dark:border-ls-gray-800">
        <div className="section-container py-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <a href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--graphite)" }}>
                <ShieldCheck size={14} className="text-[#fafafa]" />
              </div>
              <span className="font-bold text-black dark:text-white">Aegis</span>
            </a>
            <p className="text-ls-gray-500 text-xs">MIT License · Built for the STRK20 Private Sprint</p>
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
