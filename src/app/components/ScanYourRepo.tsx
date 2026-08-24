"use client";

// Self-serve scanner: anyone can check their own public repo from the site.
//
// This talks to /api/scan-repo, which always runs detect-only — it reports
// what it finds and never sweeps funds. Only repos registered for the sprint
// are swept, and only by the scheduled scan.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ScanSearch,
  Loader2,
  CheckCircle2,
  ShieldAlert,
  AlertTriangle,
  Info,
  FileWarning,
} from "lucide-react";
import type { ScanResult } from "@/lib/scan";

const EXAMPLE = "https://github.com/owner/repo";

export function ScanYourRepo() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/scan-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Scan failed");
      else setResult(data.result as ScanResult);
    } catch {
      setError("Could not reach the scanner — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="scan" className="py-24">
      <div className="section-container">
        <div className="text-center mb-10">
          <p className="eyebrow">Check your own repo</p>
          <h2 className="font-display text-3xl lg:text-4xl font-semibold text-black dark:text-white tracking-tight mb-3">
            Point it at{" "}
            <span className="font-serif font-normal italic tracking-tight" style={{ color: "var(--ink)" }}>
              your code
            </span>
          </h2>
          <p className="text-ls-gray-500 dark:text-ls-gray-400 max-w-xl mx-auto">
            Same scanner that watches the sprint registry — Gitleaks-derived rules, STARK
            curve validation and a live balance check. Read-only: it reports what it finds
            and never touches your funds.
          </p>
        </div>

        <form onSubmit={submit} className="max-w-2xl mx-auto flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={EXAMPLE}
            aria-label="Public GitHub repository URL"
            className="flex-1 px-5 py-3.5 rounded-2xl border border-ls-gray-200 dark:border-ls-gray-800
              bg-white dark:bg-ls-gray-900 text-black dark:text-white placeholder:text-ls-gray-400
              focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/15"
          />
          <button type="submit" disabled={busy || !url.trim()} className="btn-primary px-8 py-3.5 disabled:opacity-50">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ScanSearch size={16} />}
            {busy ? "Scanning…" : "Scan repo"}
          </button>
        </form>

        <AnimatePresence mode="wait">
          {error && (
            <motion.p
              key="err"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="max-w-2xl mx-auto mt-4 text-sm text-amber-700 dark:text-amber-500 flex items-center gap-2"
            >
              <AlertTriangle size={14} /> {error}
            </motion.p>
          )}

          {result && (
            <motion.div
              key="res"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="max-w-2xl mx-auto mt-6 ls-card"
            >
              <ResultView result={result} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function ResultView({ result }: { result: ScanResult }) {
  const repo = result.repoUrl.replace("https://github.com/", "");

  if (result.status === "error") {
    return (
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
        <div>
          <p className="font-bold text-black dark:text-white mb-1">Couldn&apos;t scan {repo}</p>
          <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400">{result.error}</p>
        </div>
      </div>
    );
  }

  if (result.status === "clean") {
    return (
      <div className="flex items-start gap-3">
        <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
        <div>
          <p className="font-bold text-black dark:text-white mb-1">No secrets found in {repo}</p>
          <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400">
            The scanner checks known config file names in the repository root — a clean result
            here is a good sign, not a guarantee that the whole history is clean.
          </p>
        </div>
      </div>
    );
  }

  const exposed = result.status === "leak";
  return (
    <div>
      <div className="flex items-start gap-3 mb-4">
        {exposed ? (
          <ShieldAlert size={18} className="text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
        ) : (
          <Info size={18} className="text-ls-gray-500 mt-0.5 shrink-0" />
        )}
        <div>
          <p className="font-bold text-black dark:text-white mb-1">
            {exposed
              ? `Verified exposure in ${repo}`
              : `Secrets found in ${repo} — no verified impact`}
          </p>
          <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400">
            {exposed
              ? "Something here is live or holds funds. Rotate it and move any balance to a fresh address now — a leaked key is public the moment it is committed."
              : "These look like committed credentials but nothing was confirmed live or funded. Rotate them anyway."}
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {result.findings.map((f, i) => (
          <li
            key={i}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm rounded-xl border border-ls-gray-200 dark:border-ls-gray-800 px-3 py-2"
          >
            <FileWarning size={13} className="text-ls-gray-400 shrink-0" />
            <code className="font-mono text-xs text-black dark:text-white">{f.file}</code>
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                f.severity === "warning"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400"
                  : "bg-ls-gray-100 text-ls-gray-600 dark:bg-ls-gray-800 dark:text-ls-gray-300"
              }`}
            >
              {f.severity}
            </span>
            <code className="font-mono text-xs text-ls-gray-500">{f.masked}</code>
            <span className="text-ls-gray-500 dark:text-ls-gray-400 w-full sm:w-auto">{f.detail}</span>
          </li>
        ))}
      </ul>

      <p className="text-xs text-ls-gray-400 mt-4">
        Detect-only: nothing was moved. Aegis sweeps funds for repos registered in the sprint
        registry, never for a repo scanned from this box.
      </p>
    </div>
  );
}
