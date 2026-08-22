"use client";

import { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { ExternalLink, Loader2, KeyRound, CheckCircle2, Clock3, Sparkles, Wallet2 } from "lucide-react";
import * as constants from "@/utils/constants";
import { useStoreWallet } from "./Wallet/walletContext";
import { useFrontendProvider } from "./client/provider/providerContext";
import SelectWallet from "./client/WalletHandle/SelectWallet";
import PayClaimInline from "./client/WalletHandle/PayClaimInline";

const DEFAULT_TIP_PERCENT = 2;

// Starknet addresses can differ in string form (leading zeros) while being
// the same value, so compare as BigInt rather than string equality.
function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

interface Claimable {
  repoUrl: string;
  network: "mainnet" | "sepolia";
  amount: number;
}

interface Claim {
  repoUrl: string;
  network: "mainnet" | "sepolia";
  amount: number;
  status: "pending" | "paid";
  starknetAddress: string;
  tipPercent: number;
  paidTxHash?: string;
  paidPrivately?: boolean;
}

function TipSlider({ value, onChange, amount }: { value: number; onChange: (v: number) => void; amount: number }) {
  const netPercent = 100 - value;
  const netAmount = amount * (netPercent / 100);
  const heldAmount = amount * (value / 100);
  return (
    <div className="flex-1 min-w-[220px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-1.5">
        <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400">
          Held back for fees + Aegis: <span className="font-semibold text-black dark:text-white">{value}%</span>
          {" "}({heldAmount.toFixed(4)} STRK)
        </p>
        <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          You receive {netAmount.toFixed(4)} STRK ({netPercent.toFixed(1)}%)
        </p>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-black dark:accent-white"
        aria-label="Percentage held back for fees and Aegis, rest paid to you"
        aria-valuetext={`${value}% held back, you receive ${netPercent.toFixed(1)}%`}
      />
    </div>
  );
}

export function ClaimPanel() {
  const { data: session, status } = useSession();
  const isWalletConnected = useStoreWallet((s) => s.isConnected);
  const walletAddress = useStoreWallet((s) => s.address);
  const myFrontendProviderIndex = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const walletNetworkName = constants.Strk20Networks[myFrontendProviderIndex];
  const [claimable, setClaimable] = useState<Claimable[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [tips, setTips] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [safeAddresses, setSafeAddresses] = useState<Record<"mainnet" | "sepolia", string | null>>({
    mainnet: null,
    sepolia: null,
  });

  useEffect(() => {
    fetch("/api/vault")
      .then((r) => r.json())
      .then((d) => setSafeAddresses({ mainnet: d.mainnet?.address ?? null, sepolia: d.sepolia?.address ?? null }))
      .catch(() => {});
  }, []);

  // Paying out a claim is a safe-wallet-operator action, not something a
  // random visitor's own wallet can do - it needs to actually be the wallet
  // holding the rescued funds. Gate the pay UI on that instead of just
  // "some wallet is connected", so a claimant connecting their own wallet
  // sees why nothing happens instead of a button that just fails.
  const walletNetworkKey = walletNetworkName?.toLowerCase() as "mainnet" | "sepolia" | undefined;
  const isSafeWallet =
    isWalletConnected && !!walletNetworkKey && sameAddress(walletAddress, safeAddresses[walletNetworkKey]);

  const load = () => {
    fetch("/api/claims?scope=mine")
      .then((r) => r.json())
      .then((d) => {
        setClaimable(d.claimable ?? []);
        setClaims(d.claims ?? []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (status === "authenticated") load();
  }, [status]);

  // Seed the address/tip inputs for pending claims with their current
  // values, so editing shows what's there instead of resetting to defaults.
  useEffect(() => {
    setAddresses((a) => {
      const next = { ...a };
      for (const c of claims) {
        const key = `${c.repoUrl}::${c.network}`;
        if (c.status === "pending" && next[key] === undefined) next[key] = c.starknetAddress;
      }
      return next;
    });
    setTips((t) => {
      const next = { ...t };
      for (const c of claims) {
        const key = `${c.repoUrl}::${c.network}`;
        if (c.status === "pending" && next[key] === undefined) next[key] = c.tipPercent;
      }
      return next;
    });
  }, [claims]);

  const submit = async (repoUrl: string, network: "mainnet" | "sepolia") => {
    const key = `${repoUrl}::${network}`;
    const starknetAddress = addresses[key]?.trim();
    if (!starknetAddress) {
      setError((e) => ({ ...e, [key]: "Enter the Starknet address that should receive this" }));
      return;
    }
    setSubmitting(key);
    setError((e) => ({ ...e, [key]: "" }));
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl,
          network,
          starknetAddress,
          tipPercent: tips[key] ?? DEFAULT_TIP_PERCENT,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit claim");
      load();
    } catch (e: any) {
      setError((err) => ({ ...err, [key]: e.message ?? "Failed to submit claim" }));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <section id="claim" className="py-16 border-y border-ls-gray-200 dark:border-ls-gray-800 bg-ls-gray-50 dark:bg-ls-gray-950">
      <div className="section-container max-w-2xl">
        <p className="eyebrow">
          Claim
        </p>
        <h2 className="font-display text-2xl lg:text-3xl font-semibold text-black dark:text-white tracking-tight mb-3">
          Was one of your repos rescued?
        </h2>
        <p className="text-ls-gray-500 dark:text-ls-gray-400 mb-8">
          Sign in with the GitHub account that owns the repo — we check your
          login against the repo's owner and the rescue ledger, no manual
          proof needed.
        </p>

        {status !== "authenticated" ? (
          <button
            onClick={() => signIn("github")}
            disabled={status === "loading"}
            className="btn-primary text-sm px-6 py-3 flex items-center gap-2 disabled:opacity-50"
          >
            <KeyRound size={16} /> Connect GitHub
          </button>
        ) : claimable.length === 0 && claims.length === 0 ? (
          <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400">
            Signed in as <span className="font-semibold">{session?.user?.name ?? "you"}</span> — no rescues on record for repos you own.
          </p>
        ) : (
          <>
            {claimable.map((c) => {
              const key = `${c.repoUrl}::${c.network}`;
              return (
                <div key={key} className="ls-card mb-4">
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                    <div className="min-w-0">
                      <span className="tag-ready inline-flex items-center gap-1.5 mb-2">
                        <Sparkles size={11} /> Ready to claim
                      </span>
                      <p className="font-semibold text-black dark:text-white truncate">
                        {c.repoUrl.replace("https://github.com/", "")}
                      </p>
                      <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400">
                        rescued on {c.network}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="hero-stat text-2xl text-black dark:text-white leading-none">
                        {c.amount.toFixed(4)}
                      </p>
                      <p className="text-xs font-semibold text-ls-gray-400 mt-0.5">STRK</p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 mb-3">
                    <input
                      type="text"
                      aria-label="Your Starknet address, registered with the pool"
                      placeholder="Your Starknet address, registered with the pool (paid out as a private transfer)"
                      value={addresses[key] ?? ""}
                      onChange={(e) => setAddresses((a) => ({ ...a, [key]: e.target.value }))}
                      className="flex-1 ls-input"
                    />
                    <button
                      onClick={() => submit(c.repoUrl, c.network)}
                      disabled={submitting === key}
                      className="btn-primary text-sm px-5 py-2 whitespace-nowrap disabled:opacity-50"
                    >
                      {submitting === key ? <Loader2 size={14} className="animate-spin" /> : "Claim"}
                    </button>
                  </div>
                  <TipSlider
                    value={tips[key] ?? DEFAULT_TIP_PERCENT}
                    onChange={(v) => setTips((t) => ({ ...t, [key]: v }))}
                    amount={c.amount}
                  />
                  {error[key] && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{error[key]}</p>}
                </div>
              );
            })}

            {claims.some((c) => c.status === "pending") && (
              <div
                className={`ls-card mb-4 flex items-center justify-between gap-3 ${
                  isSafeWallet
                    ? "border-emerald-200 dark:border-emerald-800/60"
                    : isWalletConnected
                    ? "border-amber-200 dark:border-amber-800/60"
                    : "border-dashed"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isSafeWallet
                        ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : isWalletConnected
                        ? "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"
                        : "bg-ls-gray-100 text-ls-gray-400 dark:bg-ls-gray-800 dark:text-ls-gray-500"
                    }`}
                  >
                    <Wallet2 size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-widest text-ls-gray-400 mb-0.5">
                      Safe wallet only
                    </p>
                    <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400 truncate">
                      {isSafeWallet
                        ? `Connected as the safe wallet · ${walletNetworkName} · ${walletAddress?.slice(0, 6)}…${walletAddress?.slice(-4)}`
                        : isWalletConnected
                        ? `This wallet (${walletAddress?.slice(0, 6)}…${walletAddress?.slice(-4)}) isn't the Aegis safe wallet — paying out is disabled until the safe wallet itself connects.`
                        : "Paying out a claim is done by whoever holds the Aegis safe wallet's key — not the claimant's own wallet. Connect it here to pay the pending claims below."}
                    </p>
                  </div>
                </div>
                <SelectWallet variant="nav" />
              </div>
            )}

            {claims.map((c) => {
              const key = `${c.repoUrl}::${c.network}`;
              const hasUnsavedEdits =
                c.status === "pending" &&
                ((addresses[key] !== undefined && addresses[key] !== c.starknetAddress) ||
                  (tips[key] !== undefined && tips[key] !== c.tipPercent));
              return (
                <div key={key} className="ls-card mb-4">
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      <span className={c.status === "paid" ? "tag-clean inline-flex items-center gap-1.5 mb-2" : "tag-pending inline-flex items-center gap-1.5 mb-2"}>
                        {c.status === "paid" ? <CheckCircle2 size={11} /> : <Clock3 size={11} />}
                        {c.status === "paid" ? (c.paidPrivately ? "Paid privately" : "Paid") : "Pending payout"}
                      </span>
                      <p className="font-semibold text-black dark:text-white truncate">
                        {c.repoUrl.replace("https://github.com/", "")}
                      </p>
                      <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400">{c.network}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="hero-stat text-2xl text-black dark:text-white leading-none">
                        {c.amount.toFixed(4)}
                      </p>
                      <p className="text-xs font-semibold text-ls-gray-400 mt-0.5">STRK</p>
                      {c.status === "paid" && (
                        <a
                          href={`https://${c.network === "sepolia" ? "sepolia." : ""}voyager.online/tx/${c.paidTxHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="link-arrow text-xs mt-1.5"
                        >
                          View tx <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                  {c.status === "pending" && (
                    <>
                      <p className="step-label">
                        <span className="step-number">1</span> You choose where it goes
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2 mb-3">
                        <input
                          type="text"
                          aria-label="Starknet address to receive this"
                          placeholder="Starknet address to receive this"
                          value={addresses[key] ?? ""}
                          onChange={(e) => setAddresses((a) => ({ ...a, [key]: e.target.value }))}
                          className="flex-1 ls-input"
                        />
                        <button
                          onClick={() => submit(c.repoUrl, c.network)}
                          disabled={
                            submitting === key ||
                            (addresses[key] === c.starknetAddress && tips[key] === c.tipPercent)
                          }
                          className="btn-ghost text-sm px-5 py-2 whitespace-nowrap disabled:opacity-50"
                        >
                          {submitting === key ? <Loader2 size={14} className="animate-spin" /> : "Update"}
                        </button>
                      </div>
                      <TipSlider
                        value={tips[key] ?? c.tipPercent}
                        onChange={(v) => setTips((t) => ({ ...t, [key]: v }))}
                        amount={c.amount}
                      />
                      {error[key] && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{error[key]}</p>}

                      <div className="ls-divider my-4" />

                      <p className="step-label">
                        <span className="step-number">2</span> The Aegis safe wallet sends it
                      </p>
                      {hasUnsavedEdits ? (
                        <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400">
                          Click Update above to save these changes before paying.
                        </p>
                      ) : (
                        <PayClaimInline
                          repoUrl={c.repoUrl}
                          network={c.network}
                          amount={c.amount}
                          tipPercent={c.tipPercent}
                          starknetAddress={c.starknetAddress}
                          isSafeWallet={isSafeWallet}
                          onPaid={load}
                        />
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </section>
  );
}
