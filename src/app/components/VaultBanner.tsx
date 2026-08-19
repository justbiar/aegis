"use client";

import { useEffect, useRef, useState } from "react";
import { Vault, ExternalLink } from "lucide-react";

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

interface VaultBannerProps {
  rescuedCount: number;
  rescuedTotal: number;
}

export function VaultBanner({ rescuedCount, rescuedTotal }: VaultBannerProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerCount, setLedgerCount] = useState(0);
  const [ledgerAvailable, setLedgerAvailable] = useState(false);

  useEffect(() => {
    fetch("/api/vault")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.balance === "number") setBalance(d.balance);
        if (d.address) setAddress(d.address);
        if (typeof d.rescuedTotal === "number") setLedgerTotal(d.rescuedTotal);
        if (typeof d.rescuedCount === "number") setLedgerCount(d.rescuedCount);
        setLedgerAvailable(Boolean(d.ledgerAvailable));
      })
      .catch(() => {});
  }, []);

  // The vault's balance can include funds that predate Aegis, so it is NOT
  // the same number as "total rescued" — that comes from the persisted
  // ledger (src/lib/ledger.ts), written the instant each rescue happens.
  // Anything the live scan finds *during* this visit lands on top of the
  // ledger snapshot fetched at page load.
  const totalRescued = ledgerTotal + rescuedTotal;
  const totalCount = ledgerCount + rescuedCount;

  const animatedBalance = useCountUp(balance ?? 0);
  const animatedRescued = useCountUp(totalRescued);

  return (
    <div className="bg-black dark:bg-ls-gray-950 border-b border-ls-gray-900">
      <div className="section-container py-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <Vault size={18} className="text-white" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              Aegis Vault · Sepolia
            </p>
            {address ? (
              <a
                href={`https://sepolia.voyager.online/contract/${address}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-white/50 hover:text-white/80 transition-colors flex items-center gap-1"
              >
                {address.slice(0, 10)}…{address.slice(-6)} <ExternalLink size={10} />
              </a>
            ) : (
              <p className="text-xs text-white/30">Loading address…</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/40 mb-0.5">
              Vault balance
            </p>
            <p className="hero-stat text-2xl text-white">
              {balance === null ? (
                <span className="text-white/30">—</span>
              ) : (
                <>
                  {animatedBalance.toFixed(2)}{" "}
                  <span className="text-sm font-semibold text-white/40">STRK</span>
                </>
              )}
            </p>
          </div>

          <div className="w-px h-9 bg-white/10" />

          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/40 mb-0.5">
              Total rescued
            </p>
            <p className="hero-stat text-2xl text-white">
              {ledgerAvailable || totalCount > 0 ? (
                <>
                  {animatedRescued.toFixed(2)}{" "}
                  <span className="text-sm font-semibold text-white/40">STRK</span>
                  <span className="text-sm font-semibold text-white/40 ml-1.5">
                    · {totalCount} {totalCount === 1 ? "account" : "accounts"}
                  </span>
                </>
              ) : (
                <span className="text-white/30 text-base font-medium">Not tracked yet</span>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
