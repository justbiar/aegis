"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, RefreshCw, Loader2, ScanSearch, CheckCircle2, ShieldAlert, AlertTriangle, CircleDashed, Info, ChevronDown } from "lucide-react";
import type { RegistryEntry } from "@/lib/registry";
import type { ScanResult } from "@/lib/scan";

// Shared status badge, used by both the desktop table and the mobile card
// list so the two layouts never drift out of sync visually.
function StatusBadge({ entry, result, scanning }: { entry: RegistryEntry; result?: ScanResult; scanning: boolean }) {
  if (!result) {
    return (
      <span className="tag-pending flex items-center gap-1 w-fit">
        {scanning ? <Loader2 size={11} className="animate-spin" /> : <CircleDashed size={11} />}
        {scanning ? "Scanning…" : "Not scanned yet"}
      </span>
    );
  }
  if (result.status === "clean") {
    return (
      <span className="tag-clean flex items-center gap-1 w-fit">
        <CheckCircle2 size={11} /> Clean
      </span>
    );
  }
  if (result.status === "error") {
    return (
      <span className="tag-error flex items-center gap-1 w-fit">
        <AlertTriangle size={11} /> Scan error
      </span>
    );
  }
  if (result.status === "info") {
    return (
      <span
        className="tag-pending flex items-center gap-1 w-fit"
        title={result.findings.map((f) => `${f.file}: ${f.detail}`).join("\n")}
      >
        <Info size={11} /> Key found, no impact
      </span>
    );
  }
  // result.status === "leak"
  const rescued = result.findings.find((f) => f.rescueTxHash);
  const explorer = rescued?.network === "mainnet"
    ? "https://voyager.online/tx/"
    : "https://sepolia.voyager.online/tx/";
  return rescued ? (
    <a
      href={`${explorer}${rescued.rescueTxHash}`}
      target="_blank"
      rel="noreferrer"
      className="tag-clean flex items-center gap-1 w-fit"
      title={result.findings.map((f) => `${f.file}: ${f.detail}`).join("\n")}
    >
      <CheckCircle2 size={11} /> Rescued
    </a>
  ) : (
    <span
      className="tag-leak flex items-center gap-1 w-fit"
      title={result.findings.map((f) => `${f.file}: ${f.detail}`).join("\n")}
    >
      <ShieldAlert size={11} /> Exposure ({result.findings.length})
    </span>
  );
}

interface RegistryTableProps {
  onResults?: (results: ScanResult[]) => void;
}

export function RegistryTable({ onResults }: RegistryTableProps = {}) {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scanResults, setScanResults] = useState<Record<string, ScanResult>>({});
  const [scanning, setScanning] = useState(false);
  // Collapsed by default — the full 60+ project list otherwise dominates the
  // page; the stats strip above already gives the at-a-glance summary.
  const [expanded, setExpanded] = useState(false);

  const load = async (): Promise<RegistryEntry[]> => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/registry");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setEntries(data.entries);
      return data.entries;
    } catch (e: any) {
      setError(e.message ?? "Failed to load registry");
      return [];
    } finally {
      setLoading(false);
    }
  };

  const scan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/scan-registry");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed");
      const results = data.results as ScanResult[];
      const byRepo: Record<string, ScanResult> = {};
      for (const r of results) byRepo[r.repoUrl] = r;
      setScanResults(byRepo);
      onResults?.(results);
    } catch (e: any) {
      setError(e.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  // Auto-scan on every visit — this is the only trigger for now, no cron yet.
  useEffect(() => {
    load().then((loaded) => {
      if (loaded.length > 0) scan();
    });
  }, []);

  return (
    <div className="ls-card p-0 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-ls-gray-200 dark:border-ls-gray-800">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-ls-gray-400">
            STRK20 Private Sprint
          </p>
          <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400 mt-0.5">
            {entries.length} registered {entries.length === 1 ? "project" : "projects"}
          </p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <button
            onClick={load}
            disabled={loading}
            className="text-xs font-semibold text-ls-gray-500 dark:text-ls-gray-400 hover:text-black
              dark:hover:text-white transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh
          </button>
          <button
            onClick={scan}
            disabled={scanning || entries.length === 0}
            className="text-xs font-semibold text-black dark:text-white flex items-center gap-1.5
              disabled:opacity-50"
          >
            {scanning ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />}
            {scanning ? "Scanning…" : "Scan registry"}
          </button>
        </div>
      </div>

      {!error && entries.length > 0 && (() => {
        const results = Object.values(scanResults);
        const rescued = results.filter((r) => r.status === "leak" && r.findings.some((f) => f.rescueTxHash)).length;
        const exposed = results.filter((r) => r.status === "leak" && !r.findings.some((f) => f.rescueTxHash)).length;
        const clean = results.filter((r) => r.status === "clean").length;
        const scannedCount = results.length;
        const stats = [
          { label: "Scanned", value: scannedCount },
          { label: "Clean", value: clean },
          { label: "Rescued", value: rescued },
          { label: "Exposure", value: exposed },
        ];
        return (
          <div
            aria-live="polite"
            aria-atomic="true"
            className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-5 py-4 border-b border-ls-gray-200 dark:border-ls-gray-800 bg-ls-gray-50/60 dark:bg-ls-gray-900/30"
          >
            {stats.map((s) => (
              <div key={s.label} className="stat-box bg-white dark:bg-ls-gray-900">
                <span className="stat-box-label">{s.label}</span>
                <span className="stat-box-value">{s.value}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {error ? (
        <p className="px-5 py-6 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : (
        <>
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                key="registry-list"
                id="registry-list"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                {/* Desktop / wide layout: a real table, no horizontal scroll needed above sm. */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="ls-table w-full">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Category</th>
                        <th>Repo</th>
                        <th>Scan status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => {
                        const result = scanResults[e.repo_url];
                        return (
                          <tr key={e.repo_url}>
                            <td className="font-semibold text-black dark:text-white">
                              {e.name ?? e.repo_url.split("/").pop()}
                            </td>
                            <td className="text-ls-gray-500 dark:text-ls-gray-400">
                              {e.category ?? "Other"}
                            </td>
                            <td>
                              <a
                                href={e.repo_url}
                                target="_blank"
                                rel="noreferrer"
                                className="link-arrow text-xs"
                              >
                                Repo <ExternalLink size={11} />
                              </a>
                            </td>
                            <td>
                              <StatusBadge entry={e} result={result} scanning={scanning} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile layout: stacked cards instead of a horizontally-scrolling table. */}
                <div className="sm:hidden divide-y divide-ls-gray-100 dark:divide-ls-gray-800">
                  {entries.map((e) => {
                    const result = scanResults[e.repo_url];
                    return (
                      <div key={e.repo_url} className="px-5 py-4 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-black dark:text-white truncate">
                            {e.name ?? e.repo_url.split("/").pop()}
                          </p>
                          <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400 mb-2">
                            {e.category ?? "Other"}
                          </p>
                          <a
                            href={e.repo_url}
                            target="_blank"
                            rel="noreferrer"
                            className="link-arrow text-xs"
                          >
                            Repo <ExternalLink size={11} />
                          </a>
                        </div>
                        <div className="shrink-0">
                          <StatusBadge entry={e} result={result} scanning={scanning} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {loading && entries.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-ls-gray-400">Loading registry…</p>
          )}

          {entries.length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-controls="registry-list"
              className="w-full flex items-center justify-center gap-1.5 px-5 py-3.5 text-sm font-semibold
                text-black dark:text-white hover:bg-ls-gray-50 dark:hover:bg-ls-gray-900/60 transition-colors"
            >
              {expanded ? "Hide project list" : `Show all ${entries.length} projects`}
              <ChevronDown size={15} className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
