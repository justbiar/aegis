import { Account, RpcProvider, CallData, uint256 } from "starknet";
import type { AccountCandidate } from "./deriveAddress";

const SEPOLIA_RPC = process.env.NEXT_PUBLIC_PROVIDER_URL
  ? `https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/${process.env.NEXT_PUBLIC_PROVIDER_URL}`
  : null;
const STRK_SEPOLIA = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

// Left in the account to cover its own deploy + transfer fees. Generous on
// purpose — Sepolia gas estimates can spike, and this is testnet STRK.
const FEE_BUFFER = 5n * 10n ** 18n; // 5 STRK

export interface RescueResult {
  rescued: boolean;
  deployTxHash?: string;
  transferTxHash?: string;
  amount?: string;
  error?: string;
}

async function isDeployed(provider: RpcProvider, address: string): Promise<boolean> {
  try {
    await provider.getClassHashAt(address);
    return true;
  } catch {
    return false;
  }
}

async function strkBalance(provider: RpcProvider, address: string): Promise<bigint> {
  const res = await provider.callContract({
    contractAddress: STRK_SEPOLIA,
    entrypoint: "balanceOf",
    calldata: [address],
  });
  return BigInt(res[0] ?? "0x0");
}

// Sweeps STRK from a leaked, funded account to the safe address. Deploys the
// account first if it's still counterfactual (deploy fee comes out of its
// own balance, since it's already funded). Sepolia only.
export async function rescueFunds(
  privateKey: string,
  candidate: AccountCandidate,
  safeAddress: string,
): Promise<RescueResult> {
  if (!SEPOLIA_RPC) return { rescued: false, error: "NEXT_PUBLIC_PROVIDER_URL not set" };

  const provider = new RpcProvider({ nodeUrl: SEPOLIA_RPC });
  const account = new Account({ provider, address: candidate.address, signer: privateKey });

  let deployTxHash: string | undefined;
  try {
    if (!(await isDeployed(provider, candidate.address))) {
      const { transaction_hash } = await account.deployAccount({
        classHash: candidate.classHash,
        constructorCalldata: candidate.calldata,
        addressSalt: candidate.salt,
      });
      deployTxHash = transaction_hash;
      await provider.waitForTransaction(transaction_hash);
    }

    const balance = await strkBalance(provider, candidate.address);
    if (balance <= FEE_BUFFER) {
      return { rescued: false, deployTxHash, error: "Balance too small to cover fees" };
    }
    const amount = balance - FEE_BUFFER;

    const { transaction_hash } = await account.execute({
      contractAddress: STRK_SEPOLIA,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: safeAddress,
        amount: uint256.bnToUint256(amount),
      }),
    });

    return {
      rescued: true,
      deployTxHash,
      transferTxHash: transaction_hash,
      amount: `${Number(amount) / 1e18} STRK`,
    };
  } catch (err: any) {
    return { rescued: false, deployTxHash, error: err?.message ?? "Rescue failed" };
  }
}
