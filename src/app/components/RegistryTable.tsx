"use client";

import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Loader2, ScanSearch } from "lucide-react";
import type { RegistryEntry } from "@/lib/registry";
import type { ScanResult } from "@/lib/scan";

interface RegistryTableProps {
  onResults?: (results: ScanResult[]) => void;
}

export function RegistryTable({ onResults }: RegistryTableProps = {}) {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scanResults, setScanResults] = useState<Record<string, ScanResult>>({});
  const [scanning, setScanning] = useState(false);

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

      {error ? (
        <p className="px-5 py-6 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : (
        <div className="overflow-x-auto">
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
                      {!result && (
                        <span className="tag-pending">
                          {scanning ? "Scanning…" : "Not scanned yet"}
                        </span>
                      )}
                      {result?.status === "clean" && <span className="tag-clean">Clean</span>}
                      {result?.status === "error" && <span className="tag-error">Scan error</span>}
                      {result?.status === "info" && (
                        <span
                          className="tag-pending"
                          title={result.findings.map((f) => `${f.file}: ${f.detail}`).join("\n")}
                        >
                          Key found, no impact
                        </span>
                      )}
                      {result?.status === "leak" && (() => {
                        const rescued = result.findings.find((f) => f.rescueTxHash);
                        return rescued ? (
                          <a
                            href={`https://sepolia.voyager.online/tx/${rescued.rescueTxHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="tag-clean"
                            title={result.findings.map((f) => `${f.file}: ${f.detail}`).join("\n")}
                          >
                            ✓ Rescued
                          </a>
                        ) : (
                          <span
                            className="tag-leak"
                            title={result.findings.map((f) => `${f.file}: ${f.detail}`).join("\n")}
                          >
                            ⚠ Exposure ({result.findings.length})
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading && entries.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-ls-gray-400">Loading registry…</p>
          )}
        </div>
      )}
    </div>
  );
}
