"use client";

import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Loader2 } from "lucide-react";
import type { RegistryEntry } from "@/lib/registry";

export function RegistryTable() {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/registry");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setEntries(data.entries);
    } catch (e: any) {
      setError(e.message ?? "Failed to load registry");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="ls-card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-ls-gray-200 dark:border-ls-gray-800">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-ls-gray-400">
            STRK20 Private Sprint
          </p>
          <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400 mt-0.5">
            {entries.length} registered {entries.length === 1 ? "project" : "projects"}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs font-semibold text-ls-gray-500 dark:text-ls-gray-400 hover:text-black
            dark:hover:text-white transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
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
              {entries.map((e) => (
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
                    <span className="tag-pending">Not scanned yet</span>
                  </td>
                </tr>
              ))}
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
