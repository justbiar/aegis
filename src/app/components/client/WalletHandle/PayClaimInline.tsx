"use client";

import { useState } from "react";
import { num } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";
import * as constants from "@/utils/constants";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";

const TOKEN = constants.addrSTRK;

interface Props {
  repoUrl: string;
  network: "mainnet" | "sepolia";
  amount: number;
  tipPercent: number;
  starknetAddress: string;
  isSafeWallet: boolean;
  onPaid: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "confirming" }
  | { kind: "ok"; txHash: string }
  | { kind: "error"; message: string };

// Pays one claim as a private in-pool STRK20 transfer, right inside its own
// claim card - reads the same global wallet store SelectWallet uses, so
// connecting once (from the bar above the claim list) lights this button up
// on every pending claim at once, instead of a separate "pay" surface
// showing the same claims again in a different layout.
export default function PayClaimInline({ repoUrl, network, amount, tipPercent, starknetAddress, isSafeWallet, onPaid }: Props) {
  const myWalletAccount = useStoreWallet((s) => s.myWalletAccount);
  const connectedAddress = useStoreWallet((s) => s.address);
  const isConnected = useStoreWallet((s) => s.isConnected);
  const myFrontendProviderIndex = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const networkName = constants.Strk20Networks[myFrontendProviderIndex];

  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const netAmount = amount * (1 - tipPercent / 100);
  const networkMatches = isConnected && networkName?.toLowerCase() === network;
  const busy = status.kind === "sending" || status.kind === "confirming";

  const explorerTxUrl = (h: string) =>
    network === "mainnet" ? `https://voyager.online/tx/${h}` : `https://sepolia.voyager.online/tx/${h}`;

  const handlePay = async () => {
    if (!myWalletAccount || !connectedAddress) return;
    setStatus({ kind: "sending" });
    const amountWei = BigInt(Math.round(netAmount * 1e18));
    const actions: WALLET_API.STRK20_ACTION[] = [
      { type: "transfer", token: TOKEN, amount: num.toHex(amountWei), recipient: starknetAddress },
    ];
    let txH: string;
    try {
      const r = await myWalletAccount.strk20InvokeTransaction(actions);
      txH = r.transaction_hash;
    } catch (error: any) {
      const msg = error?.message ?? error?.toString?.() ?? String(error);
      setStatus({
        kind: "error",
        message: /NOT_REGISTERED/i.test(msg)
          ? "The connected wallet or the recipient isn't registered with the pool yet - both sides need a real Shield done from their own wallet first."
          : msg,
      });
      return;
    }
    setStatus({ kind: "confirming" });
    const provider = constants.myFrontendProviders[myFrontendProviderIndex];
    try {
      const txR: any = await provider.waitForTransaction(txH, { retries: 400, retryInterval: 3000 });
      const exec = txR?.value?.execution_status ?? txR?.execution_status;
      if (exec === "REVERTED") {
        setStatus({ kind: "error", message: "Transaction reverted on-chain." });
        return;
      }
    } catch (error: any) {
      setStatus({ kind: "error", message: error?.message ?? "Could not confirm the transaction." });
      return;
    }
    setStatus({ kind: "ok", txHash: txH });
    try {
      const res = await fetch("/api/claims/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, network, txHash: txH, payerAddress: connectedAddress }),
      });
      if (res.ok) onPaid();
    } catch {
      // the transfer already succeeded on-chain; bookkeeping can be retried manually
    }
  };

  if (status.kind === "ok") {
    return (
      <a
        href={explorerTxUrl(status.txHash)}
        target="_blank"
        rel="noreferrer"
        className="tag-clean inline-flex items-center gap-1 mt-3"
      >
        Paid privately ↗
      </a>
    );
  }

  return (
    <div className="mt-3" aria-live="polite">
      {!isConnected ? (
        <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400">
          Connect the safe wallet above to pay this out privately.
        </p>
      ) : !isSafeWallet ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Connected wallet isn't the Aegis safe wallet — only whoever holds
          its key can pay this out.
        </p>
      ) : !networkMatches ? (
        <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400">
          Connected wallet is on {networkName ?? "an unsupported network"} — switch it to {network} to pay this.
        </p>
      ) : (
        <button onClick={handlePay} disabled={busy} className="btn-ghost text-sm px-4 py-2 disabled:opacity-50">
          {status.kind === "sending"
            ? "Confirm in your wallet…"
            : status.kind === "confirming"
            ? "Waiting for confirmation…"
            : `Pay ${netAmount.toFixed(4)} STRK privately`}
        </button>
      )}
      {status.kind === "error" && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{status.message}</p>}
    </div>
  );
}
