"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, RefreshCw } from "lucide-react";
import * as constants from "@/utils/constants";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";

// Prompts the CONNECTED wallet to register with the pool. Registration —
// publishing the wallet's viewing key — happens inside the wallet's OWN native
// Shield feature (it generates/publishes the viewing key and gets the
// screening-partner signature there), NOT through a dapp-triggered deposit: the
// pool rejects a deposit from an unregistered account with NOT_REGISTERED,
// because the note a deposit creates has to be encrypted to a viewing key that
// doesn't exist yet. So this can't be a one-click action from here — it guides
// the user to their wallet, then re-checks on demand. Self-hides once the
// connected wallet reads back as registered.
export default function RegisterWallet({
  network,
  onRegistered,
}: {
  network: "mainnet" | "sepolia";
  onRegistered?: () => void;
}) {
  const connectedAddress = useStoreWallet((s) => s.address);
  const isConnected = useStoreWallet((s) => s.isConnected);
  const index = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const networkName = constants.Strk20Networks[index];

  const [registered, setRegistered] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const networkMatches = isConnected && networkName?.toLowerCase() === network;

  const check = async () => {
    if (!isConnected || !connectedAddress) {
      setRegistered(null);
      return;
    }
    setChecking(true);
    const ok = await constants.isRegisteredInPool(index, connectedAddress);
    setRegistered(ok);
    setChecking(false);
    if (ok) onRegistered?.();
  };

  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAddress, isConnected, index]);

  // Registered, still loading, or wallet is on another network — nothing to show.
  if (registered !== false || !networkMatches) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-900/10 px-4 py-3" aria-live="polite">
      <div className="flex items-start gap-2 mb-2.5">
        <ShieldCheck size={15} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="text-xs text-ls-gray-600 dark:text-ls-gray-300 space-y-1.5">
          <p>
            This wallet isn&apos;t registered with the {network} pool yet, so it can&apos;t send or receive private
            transfers. Registering happens in your wallet&apos;s own Shield feature — it can&apos;t be done from here.
          </p>
          <p className="text-ls-gray-500 dark:text-ls-gray-400">
            Open your wallet (Ready / Argent) → its <span className="font-semibold">Shield / privacy</span> section →
            Shield any amount of STRK once. That publishes your viewing key. Then re-check below.
          </p>
        </div>
      </div>
      <button
        onClick={check}
        disabled={checking}
        className="btn-ghost text-sm px-4 py-2 disabled:opacity-50"
      >
        {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {checking ? "Checking…" : "I've shielded — re-check"}
      </button>
    </div>
  );
}
