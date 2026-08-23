"use client";

import { useEffect, useRef, useState } from "react";
import { Vault, ExternalLink } from "lucide-react";
import type { Network } from "@/lib/networks";

function useCountUp(target: number, durationMs = 900) {
  const [value, setValue] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const base = from.current;
    let raf: number;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(base + (target - base) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}

interface NetworkVaultInfo {
  address: string | null;
  balance: number | null;
  rescuedTotal: number;
  rescuedCount: number;
  requestedTotal: number;
  requestedCount: number;
}

interface VaultRowProps {
  network: Network;
  info: NetworkVaultInfo | null;
  ledgerAvailable: boolean;
  liveCount: number;
  liveTotal: number;
  compact?: boolean;
}

function VaultRow({ network, info, ledgerAvailable, liveCount, liveTotal, compact }: VaultRowProps) {
  const label = network === "mainnet" ? "Mainnet" : "Sepolia";
  const explorer = network === "mainnet"
    ? "https://voyager.online/contract/"
    : "https://sepolia.voyager.online/contract/";

  const balance = info?.balance ?? null;
  const totalRescued = (info?.rescuedTotal ?? 0) + liveTotal;
  const totalCount = (info?.rescuedCount ?? 0) + liveCount;
  const requestedTotal = info?.requestedTotal ?? 0;
  const requestedCount = info?.requestedCount ?? 0;

  const animatedBalance = useCountUp(balance ?? 0);
  const animatedRescued = useCountUp(totalRescued);
  const animatedRequested = useCountUp(requestedTotal);

  const statSize = compact ? "text-xl" : "text-3xl";
  const labelSize = compact ? "text-[10px]" : "text-[11px]";

  return (
    <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${compact ? "py-3" : "py-5"}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`${compact ? "w-7 h-7" : "w-9 h-9"} rounded-xl bg-ls-gray-200 dark:bg-ls-gray-800 flex items-center justify-center shrink-0`}>
          <Vault size={compact ? 14 : 18} className="text-black dark:text-white" />
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-2 mb-1">
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 ${
                network === "mainnet"
                  ? "bg-[#242424] text-[#fafafa]"
                  : "border border-ls-gray-300 text-ls-gray-600 dark:border-ls-gray-600 dark:text-ls-gray-300"
              }`}
            >
              {label}
            </span>
            <span className={`${labelSize} font-bold uppercase tracking-widest text-ls-gray-500 dark:text-ls-gray-400`}>Aegis Vault</span>
          </p>
          {info?.address ? (
            <a
              href={`${explorer}${info.address}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-ls-gray-500 hover:text-black dark:hover:text-white transition-colors inline-flex items-center gap-1 truncate"
            >
              {info.address.slice(0, 10)}…{info.address.slice(-6)} <ExternalLink size={10} className="shrink-0" />
            </a>
          ) : info === null ? (
            <p className="text-xs text-ls-gray-400">Loading address…</p>
          ) : (
            <p className="text-xs text-ls-gray-400">Not configured</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:flex sm:items-center gap-x-6 gap-y-2 sm:gap-8 pl-[calc(1.75rem+0.75rem)] sm:pl-0">
        <div className="text-left sm:text-right">
          <p className={`${labelSize} font-semibold uppercase tracking-widest text-ls-gray-500 dark:text-ls-gray-400 mb-0.5`}>
            Vault balance
          </p>
          <p className={`hero-stat ${statSize} text-black dark:text-white leading-none`}>
            {balance === null ? (
              <span className="text-ls-gray-400">—</span>
            ) : (
              <>
                {animatedBalance.toFixed(2)}{" "}
                <span className="text-sm font-semibold text-ls-gray-500 dark:text-ls-gray-400">STRK</span>
              </>
            )}
          </p>
        </div>

        <div className="hidden sm:block w-px h-9 bg-ls-gray-200 dark:bg-ls-gray-800" />

        <div className="text-left sm:text-right">
          <p className={`${labelSize} font-semibold uppercase tracking-widest text-ls-gray-500 dark:text-ls-gray-400 mb-0.5`}>
            Total rescued
          </p>
          <p className={`hero-stat ${statSize} text-black dark:text-white leading-none`}>
            {ledgerAvailable || totalCount > 0 ? (
              <>
                {animatedRescued.toFixed(2)}{" "}
                <span className="text-sm font-semibold text-ls-gray-500 dark:text-ls-gray-400">STRK</span>
              </>
            ) : (
              <span className="text-ls-gray-400 text-base font-medium">Not tracked yet</span>
            )}
          </p>
          {(ledgerAvailable || totalCount > 0) && (
            <p className="text-xs font-medium text-ls-gray-500 dark:text-ls-gray-400 mt-0.5">
              {totalCount} {totalCount === 1 ? "account" : "accounts"}
            </p>
          )}
        </div>

        <div className="hidden sm:block w-px h-9 bg-ls-gray-200 dark:bg-ls-gray-800" />

        <div className="text-left sm:text-right">
          <p className={`${labelSize} font-semibold uppercase tracking-widest text-ls-gray-500 dark:text-ls-gray-400 mb-0.5`}>
            Requested
          </p>
          <p className={`hero-stat ${statSize} text-black dark:text-white leading-none`}>
            {ledgerAvailable || requestedCount > 0 ? (
              <>
                {animatedRequested.toFixed(2)}{" "}
                <span className="text-sm font-semibold text-ls-gray-500 dark:text-ls-gray-400">STRK</span>
              </>
            ) : (
              <span className="text-ls-gray-400 text-base font-medium">—</span>
            )}
          </p>
          {(ledgerAvailable || requestedCount > 0) && (
            <p className="text-xs font-medium text-ls-gray-500 dark:text-ls-gray-400 mt-0.5">
              {requestedCount} pending {requestedCount === 1 ? "claim" : "claims"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface VaultBannerProps {
  rescuedCount: number;
  rescuedTotal: number;
  rescuedCountMainnet?: number;
  rescuedTotalMainnet?: number;
}

export function VaultBanner({
  rescuedCount,
  rescuedTotal,
  rescuedCountMainnet = 0,
  rescuedTotalMainnet = 0,
}: VaultBannerProps) {
  const [mainnet, setMainnet] = useState<NetworkVaultInfo | null>(null);
  const [sepolia, setSepolia] = useState<NetworkVaultInfo | null>(null);
  const [ledgerAvailable, setLedgerAvailable] = useState(false);

  useEffect(() => {
    fetch("/api/vault")
      .then((r) => r.json())
      .then((d) => {
        if (d.mainnet) setMainnet(d.mainnet);
        if (d.sepolia) setSepolia(d.sepolia);
        setLedgerAvailable(Boolean(d.ledgerAvailable));
      })
      .catch(() => {});
  }, []);

  return (
    <div className="border-y border-ls-gray-200 dark:border-ls-gray-800">
      <div className="section-container">
        <VaultRow
          network="mainnet"
          info={mainnet}
          ledgerAvailable={ledgerAvailable}
          liveCount={rescuedCountMainnet}
          liveTotal={rescuedTotalMainnet}
        />
        <div className="border-t border-ls-gray-200 dark:border-ls-gray-800">
          <VaultRow
            network="sepolia"
            info={sepolia}
            ledgerAvailable={ledgerAvailable}
            liveCount={rescuedCount}
            liveTotal={rescuedTotal}
            compact
          />
        </div>
      </div>
    </div>
  );
}
