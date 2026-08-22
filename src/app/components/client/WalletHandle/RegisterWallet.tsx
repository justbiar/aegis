"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { num } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";
import * as constants from "@/utils/constants";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";

const TOKEN = constants.addrSTRK;
// Amount Shielded to register. A first deposit is what publishes the wallet's
// viewing key (= registration). Mirrors the proven 10 STRK shield; the funds
// stay the user's own shielded balance (recoverable via Unshield), only the
// pool fee + gas are actually spent.
const REGISTER_DEPOSIT_STRK = 10n;

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "confirming" }
  | { kind: "error"; message: string };

// Registers the CONNECTED wallet with the pool by doing one Shield (deposit)
// from it — the only way to publish its viewing key so it can send/receive
// private transfers. Self-checks registration and renders nothing once the
// connected wallet is already registered. It can only ever register the
// wallet that's connected (a third-party recipient must register itself).
export default function RegisterWallet({
  network,
  onRegistered,
}: {
  network: "mainnet" | "sepolia";
  onRegistered?: () => void;
}) {
  const myWalletAccount = useStoreWallet((s) => s.myWalletAccount);
  const connectedAddress = useStoreWallet((s) => s.address);
  const isConnected = useStoreWallet((s) => s.isConnected);
  const index = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const networkName = constants.Strk20Networks[index];

  const [registered, setRegistered] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const networkMatches = isConnected && networkName?.toLowerCase() === network;

  const check = async () => {
    if (!isConnected || !connectedAddress) {
      setRegistered(null);
      return;
    }
    const ok = await constants.isRegisteredInPool(index, connectedAddress);
    setRegistered(ok);
  };

  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAddress, isConnected, index]);

  // Already registered, still checking, or wallet is on another network — the
  // batch / request flow shows the right guidance in those cases, not this.
  if (registered !== false || !networkMatches) return null;

  const busy = status.kind === "sending" || status.kind === "confirming";

  const handleRegister = async () => {
    if (!myWalletAccount) return;
    setStatus({ kind: "sending" });
    const actions: WALLET_API.STRK20_ACTION[] = [
      { type: "deposit", token: TOKEN, amount: num.toHex(REGISTER_DEPOSIT_STRK * 10n ** 18n) },
    ];
    let txH: string;
    try {
      const r = await myWalletAccount.strk20InvokeTransaction(actions);
      txH = r.transaction_hash;
    } catch (error: any) {
      setStatus({ kind: "error", message: error?.message ?? error?.toString?.() ?? String(error) });
      return;
    }
    setStatus({ kind: "confirming" });
    try {
      const provider = constants.myFrontendProviders[index];
      const txR: any = await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      const exec = txR?.value?.execution_status ?? txR?.execution_status;
      if (exec === "REVERTED") {
        setStatus({ kind: "error", message: "Registration transaction reverted on-chain." });
        return;
      }
    } catch (error: any) {
      setStatus({ kind: "error", message: error?.message ?? "Could not confirm the registration." });
      return;
    }
    setStatus({ kind: "idle" });
    await check();
    onRegistered?.();
  };

  return (
    <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-900/10 px-4 py-3" aria-live="polite">
      <div className="flex items-start gap-2 mb-2.5">
        <ShieldCheck size={15} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <p className="text-xs text-ls-gray-600 dark:text-ls-gray-300">
          This wallet isn&apos;t registered with the {network} pool yet — register it once to send or receive private
          transfers. It Shields {REGISTER_DEPOSIT_STRK.toString()} STRK (your own, recoverable later) and pays a one-time
          pool fee.
        </p>
      </div>
      <button onClick={handleRegister} disabled={busy} className="btn-primary text-sm px-4 py-2 disabled:opacity-50">
        {status.kind === "sending"
          ? "Confirm in your wallet…"
          : status.kind === "confirming"
          ? "Registering…"
          : "Register with the pool"}
      </button>
      {status.kind === "error" && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{status.message}</p>}
    </div>
  );
}
