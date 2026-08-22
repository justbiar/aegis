"use client";

import { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { ExternalLink, Loader2, KeyRound, CheckCircle2, Clock3, Sparkles, Check, Wallet2 } from "lucide-react";
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

function shortAddr(a?: string | null): string {
  if (!a) return "";
  return a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a;
}

type NetworkKey = "mainnet" | "sepolia";

// Frontend provider index that each pool network lives on (see constants.ts:
// 0 = Mainnet, 2 = Sepolia).
const NETWORK_INDEX: Record<NetworkKey, number> = { mainnet: 0, sepolia: 2 };

interface Claimable {
  repoUrl: string;
  network: NetworkKey;
  amount: number;
}

interface Claim {
  repoUrl: string;
  network: NetworkKey;
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
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
        <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400">
          Held for fees + Aegis · <span className="font-semibold text-black dark:text-white">{value}%</span>
        </p>
        <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
          You receive {netAmount.toFixed(4)} STRK
        </p>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
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
  const setFrontendProviderIndex = useFrontendProvider((s) => s.setCurrentFrontendProviderIndex);
  const walletNetworkName = constants.Strk20Networks[myFrontendProviderIndex];
  const [claimable, setClaimable] = useState<Claimable[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [tips, setTips] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [safeAddresses, setSafeAddresses] = useState<Record<NetworkKey, string | null>>({
    mainnet: null,
    sepolia: null,
  });

  useEffect(() => {
    fetch("/api/vault")
      .then((r) => r.json())
      .then((d) => setSafeAddresses({ mainnet: d.mainnet?.address ?? null, sepolia: d.sepolia?.address ?? null }))
      .catch(() => {});
  }, []);

  // The network the panel is currently showing — derived from the same
  // provider index the wallet/pay flow uses, so "Mainnet" here and the
  // network a payout goes out on are always the same thing.
  const selectedNetwork: NetworkKey = myFrontendProviderIndex === NETWORK_INDEX.mainnet ? "mainnet" : "sepolia";

  // A connected wallet plays one of two roles: the claimant's receiving wallet,
  // or the safe wallet paying claims out. Only the former should drive the
  // "receiving address" — the safe-wallet operator connects to pay, not to
  // redirect where funds land.
  const walletNetworkKey = walletNetworkName?.toLowerCase() as NetworkKey | undefined;
  const isSafeWallet =
    isWalletConnected && !!walletNetworkKey && sameAddress(walletAddress, safeAddresses[walletNetworkKey]);
  const receivingFromWallet = isWalletConnected && !!walletAddress && !isSafeWallet;

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

  // Submit / update a claim — the receiving address is always the connected
  // wallet (that's the DEX-style "connect to receive" model), so there's no
  // hand-typed address to validate, just a wallet to require.
  const submit = async (repoUrl: string, network: NetworkKey, tipPercent: number) => {
    const key = `${repoUrl}::${network}`;
    if (!receivingFromWallet) {
      setError((e) => ({ ...e, [key]: "Connect the wallet that should receive this first" }));
      return;
    }
    setSubmitting(key);
    setError((e) => ({ ...e, [key]: "" }));
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, network, starknetAddress: walletAddress, tipPercent }),
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

  // Wallet-driven receiving-address row. When a (non-safe) wallet is connected
  // it shows that wallet's address with a DEX-style "Change" that reopens the
  // wallet picker; otherwise it prompts to connect. `savedAddr` is the
  // already-submitted destination for a pending claim.
  const renderAddressField = (savedAddr?: string) => {
    if (receivingFromWallet) {
      return (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-ls-gray-50 dark:bg-ls-gray-800/60 border border-ls-gray-200 dark:border-ls-gray-700 px-4 py-2.5">
          <div className="min-w-0">
            <p className="font-mono text-sm text-black dark:text-white truncate">{shortAddr(walletAddress)}</p>
            <p className="text-[11px] text-ls-gray-400">Receiving to your connected wallet</p>
          </div>
          <SelectWallet variant="change" />
        </div>
      );
    }
    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-dashed border-ls-gray-300 dark:border-ls-gray-700 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Wallet2 size={15} className="text-ls-gray-400 shrink-0" />
          <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400 min-w-0">
            {savedAddr ? (
              <>Receiving to <span className="font-mono">{shortAddr(savedAddr)}</span> — connect that wallet to change it.</>
            ) : (
              "Connect the wallet that should receive this."
            )}
          </p>
        </div>
        <SelectWallet variant="nav" />
      </div>
    );
  };

  const visibleClaimable = claimable.filter((c) => c.network === selectedNetwork);
  const visibleClaims = claims.filter((c) => c.network === selectedNetwork);
  const hasAny = claimable.length > 0 || claims.length > 0;
  const netCount = (n: NetworkKey) =>
    claimable.filter((c) => c.network === n).length + claims.filter((c) => c.network === n).length;

  return (
    <section id="claim" className="py-16 border-y border-ls-gray-200 dark:border-ls-gray-800 bg-ls-gray-50 dark:bg-ls-gray-950">
      <div className="section-container max-w-2xl">
        <p className="eyebrow">Claim</p>
        <h2 className="font-display text-2xl lg:text-3xl font-semibold text-black dark:text-white tracking-tight mb-3">
          Was one of your repos rescued?
        </h2>
        <p className="text-ls-gray-500 dark:text-ls-gray-400 mb-8">
          Sign in with the GitHub account that owns the repo — we match your
          login against the repo's owner and the rescue ledger, no manual proof
          needed.
        </p>

        {status !== "authenticated" ? (
          <button
            onClick={() => signIn("github")}
            disabled={status === "loading"}
            className="btn-primary text-sm px-6 py-3 disabled:opacity-50"
          >
            <KeyRound size={16} /> Connect GitHub
          </button>
        ) : !hasAny ? (
          <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400">
            Signed in as <span className="font-semibold">{session?.user?.name ?? "you"}</span> — no rescues on record for repos you own.
          </p>
        ) : (
          <>
            {/* Network switch — one network at a time keeps mainnet and testnet
                claims from stacking up together. */}
            <div className="inline-flex items-center gap-1 p-1 mb-6 rounded-xl bg-ls-gray-100 dark:bg-ls-gray-900 border border-ls-gray-200 dark:border-ls-gray-800">
              {(["mainnet", "sepolia"] as NetworkKey[]).map((n) => {
                const active = selectedNetwork === n;
                const count = netCount(n);
                return (
                  <button
                    key={n}
                    onClick={() => setFrontendProviderIndex(NETWORK_INDEX[n])}
                    className={`px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition-colors flex items-center gap-2 ${
                      active
                        ? "bg-white dark:bg-ls-gray-700 text-black dark:text-white shadow-sm"
                        : "text-ls-gray-500 dark:text-ls-gray-400 hover:text-black dark:hover:text-white"
                    }`}
                  >
                    {n}
                    {count > 0 && (
                      <span
                        className={`text-[11px] font-bold px-1.5 rounded-full ${
                          active ? "bg-black text-white dark:bg-white dark:text-black" : "bg-ls-gray-200 dark:bg-ls-gray-800"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {visibleClaimable.length === 0 && visibleClaims.length === 0 ? (
              <p className="text-sm text-ls-gray-500 dark:text-ls-gray-400">
                Nothing on <span className="font-semibold capitalize">{selectedNetwork}</span> — switch networks above to see your other claims.
              </p>
            ) : (
              <>
                {/* Ready-to-claim (not yet submitted) */}
                {visibleClaimable.map((c) => {
                  const key = `${c.repoUrl}::${c.network}`;
                  const tip = tips[key] ?? DEFAULT_TIP_PERCENT;
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
                        </div>
                        <div className="text-right shrink-0">
                          <p className="hero-stat text-4xl text-black dark:text-white leading-none tracking-tight">
                            {c.amount.toFixed(4)}
                          </p>
                          <p className="text-xs font-semibold text-ls-gray-400 mt-0.5">STRK</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {renderAddressField()}
                        <TipSlider value={tip} onChange={(v) => setTips((t) => ({ ...t, [key]: v }))} amount={c.amount} />
                        {receivingFromWallet && (
                          <button
                            onClick={() => submit(c.repoUrl, c.network, tip)}
                            disabled={submitting === key}
                            className="btn-primary text-sm px-5 py-2 disabled:opacity-50"
                          >
                            {submitting === key ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} /> Claim to this wallet</>}
                          </button>
                        )}
                      </div>
                      {error[key] && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{error[key]}</p>}
                    </div>
                  );
                })}

                {/* Slim safe-wallet hint, only when there's a pending payout and
                    the safe wallet isn't the one connected. Reworded so it never
                    contradicts an already-connected (claimant) wallet: it either
                    prompts to connect the safe wallet, or offers to switch to it. */}
                {visibleClaims.some((c) => c.status === "pending") && !isSafeWallet && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 px-4 py-3 rounded-2xl border border-dashed border-ls-gray-300 dark:border-ls-gray-700">
                    <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400">
                      {isWalletConnected ? (
                        <>Only the <span className="font-semibold text-black dark:text-white">Aegis safe wallet</span> can pay these out — switch to it if you're paying.</>
                      ) : (
                        <>Paying out is done by the <span className="font-semibold text-black dark:text-white">Aegis safe wallet</span>. Connect it only if you're the one paying.</>
                      )}
                    </p>
                    {isWalletConnected ? <SelectWallet variant="change" /> : <SelectWallet variant="nav" />}
                  </div>
                )}

                {/* Submitted claims (pending / paid) */}
                {visibleClaims.map((c) => {
                  const key = `${c.repoUrl}::${c.network}`;
                  const tip = tips[key] ?? c.tipPercent;
                  // A change to save exists when the claimant connected a
                  // different receiving wallet, or moved the tip slider.
                  const addrChanged = receivingFromWallet && !sameAddress(walletAddress, c.starknetAddress);
                  const tipChanged = tip !== c.tipPercent;
                  const hasUnsavedEdits = c.status === "pending" && (addrChanged || tipChanged);
                  return (
                    <div key={key} className="ls-card mb-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <span className={c.status === "paid" ? "tag-clean inline-flex items-center gap-1.5 mb-2" : "tag-pending inline-flex items-center gap-1.5 mb-2"}>
                            {c.status === "paid" ? <CheckCircle2 size={11} /> : <Clock3 size={11} />}
                            {c.status === "paid" ? (c.paidPrivately ? "Paid privately" : "Paid") : "Pending payout"}
                          </span>
                          <p className="font-semibold text-black dark:text-white truncate">
                            {c.repoUrl.replace("https://github.com/", "")}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="hero-stat text-4xl text-black dark:text-white leading-none tracking-tight">
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
                        <div className="mt-4 space-y-3">
                          {renderAddressField(c.starknetAddress)}
                          <TipSlider value={tip} onChange={(v) => setTips((t) => ({ ...t, [key]: v }))} amount={c.amount} />
                          {error[key] && <p className="text-sm text-red-600 dark:text-red-400">{error[key]}</p>}

                          <div className="pt-1">
                            {hasUnsavedEdits ? (
                              <button
                                onClick={() => submit(c.repoUrl, c.network, tip)}
                                disabled={submitting === key}
                                className="btn-primary text-sm px-5 py-2 disabled:opacity-50"
                              >
                                {submitting === key ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} /> Save changes</>}
                              </button>
                            ) : isSafeWallet ? (
                              // Only the safe-wallet operator sees the actual pay
                              // control — the claimant has already done their part.
                              <PayClaimInline
                                repoUrl={c.repoUrl}
                                network={c.network}
                                amount={c.amount}
                                tipPercent={c.tipPercent}
                                starknetAddress={c.starknetAddress}
                                isSafeWallet={isSafeWallet}
                                onPaid={load}
                              />
                            ) : (
                              <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400 flex items-start gap-1.5">
                                <Clock3 size={13} className="mt-0.5 shrink-0" />
                                <span>
                                  Manual payout — whoever holds the Aegis safe wallet sends this
                                  privately (no automatic transfer). Connect it above to pay it out.
                                </span>
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
