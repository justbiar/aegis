// Shared network config — Sepolia + mainnet, one Alchemy key covering both
// subdomains. Pulled out of scan.ts so rescue.ts can import it without a
// circular scan.ts <-> rescue.ts dependency.
export type Network = "mainnet" | "sepolia";

// Every network Aegis works on, for the places that have to walk all of
// them rather than look one up.
export const NETWORKS: Network[] = ["mainnet", "sepolia"];

export const RPC_URL: Record<Network, string | null> = {
  mainnet: process.env.NEXT_PUBLIC_PROVIDER_URL
    ? `https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/${process.env.NEXT_PUBLIC_PROVIDER_URL}`
    : null,
  sepolia: process.env.NEXT_PUBLIC_PROVIDER_URL
    ? `https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/${process.env.NEXT_PUBLIC_PROVIDER_URL}`
    : null,
};

export const SAFE_WALLET: Record<Network, string | null> = {
  mainnet: process.env.SAFE_WALLET_ADDRESS_MAINNET ?? null,
  sepolia: process.env.SAFE_WALLET_ADDRESS ?? null,
};

// Same contract address on both networks — STRK and ETH were declared with
// the same class + salt on mainnet and Sepolia.
export const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const ETH_TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

// Other tokens a leaked account might hold, allowed to be swapped into STRK
// before the sweep. Deliberately a fixed allowlist, not "whatever's in the
// wallet" — swapping an unknown/unverified token means calling into a
// contract we don't control, which is exactly the kind of thing a bot that
// hunts for leaked keys should be paranoid about (a planted "leak" could
// hold a malicious token designed to exploit the swap/approve step).
// Addresses from https://github.com/starknet-io/starknet-addresses
// (bridged_tokens/mainnet.json + sepolia.json). DAI has no Sepolia bridge
// deployment, hence null there.
export interface SwapToken {
  symbol: string;
  address: Record<Network, string | null>;
}

export const SWAP_WHITELIST: SwapToken[] = [
  {
    symbol: "USDC",
    address: {
      mainnet: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
      sepolia: "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080",
    },
  },
  {
    symbol: "USDT",
    address: {
      mainnet: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8",
      sepolia: "0x02ab8758891e84b968ff11361789070c6b1af2df618d6d2f4a78b0757573c6eb",
    },
  },
  {
    symbol: "DAI",
    address: {
      mainnet: "0x05574eb6b8789a91466f902c380d978e472db68170ff82a5b650b95a58ddf4ad",
      sepolia: null,
    },
  },
  {
    symbol: "WBTC",
    address: {
      mainnet: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
      sepolia: "0x00452bd5c0512a61df7c7be8cfea5e4f893cb40e126bdc40aee6054db955129e",
    },
  },
  {
    symbol: "wstETH",
    address: {
      mainnet: "0x0057912720381af14b0e5c87aa4718ed5e527eab60b3801ebf702ab09139e38b",
      sepolia: "0x030de54c07e57818ae4a1210f2a3018a0b9521b8f8ae5206605684741650ac25",
    },
  },
];
