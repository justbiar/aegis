import { Account, RpcProvider, CallData, uint256 } from "starknet";
import { RPC_URL, SAFE_WALLET, STRK_TOKEN, type Network } from "./networks";

const SAFE_WALLET_PRIVATE_KEY = process.env.SAFE_WALLET_PRIVATE_KEY ?? null;

export interface PayoutResult {
  paid: boolean;
  txHash?: string;
  error?: string;
}

// Pays a verified claim straight out of the safe wallet — a plain, public
// STRK transfer, not a private one. This exists so a claimant isn't stuck
// waiting on someone to manually trigger a private transfer (see the "Pay
// claims" tab in WalletAccountV6Tag, which does that instead, once the
// mainnet proving service is available and someone connects the safe
// wallet). Automatic beats private here: the whole point of a claim is the
// owner actually getting their money back.
export async function payoutClaim(
  network: Network,
  recipient: string,
  amount: number,
): Promise<PayoutResult> {
  const rpc = RPC_URL[network];
  const safeAddress = SAFE_WALLET[network];
  if (!rpc) return { paid: false, error: "NEXT_PUBLIC_PROVIDER_URL not set" };
  if (!safeAddress) return { paid: false, error: "Safe wallet address not configured for this network" };
  if (!SAFE_WALLET_PRIVATE_KEY) return { paid: false, error: "SAFE_WALLET_PRIVATE_KEY not set" };

  const provider = new RpcProvider({ nodeUrl: rpc });
  const account = new Account({ provider, address: safeAddress, signer: SAFE_WALLET_PRIVATE_KEY });

  const amountWei = BigInt(Math.round(amount * 1e18));

  try {
    const { transaction_hash } = await account.execute({
      contractAddress: STRK_TOKEN,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient,
        amount: uint256.bnToUint256(amountWei),
      }),
    });
    await provider.waitForTransaction(transaction_hash);
    return { paid: true, txHash: transaction_hash };
  } catch (err: any) {
    return { paid: false, error: err?.message ?? "Payout failed" };
  }
}
