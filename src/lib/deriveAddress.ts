import { ec, hash } from "starknet";

export interface AccountCandidate {
  address: string;
  classHash: string;
  calldata: string[];
  salt: string;
}

// A raw private key alone doesn't have one canonical Starknet address — unlike
// EVM, the address depends on which account contract (class hash) was
// deployed with it. We can't know that for certain, so we compute candidate
// addresses for the account types real wallets actually use and let the
// caller check each one on-chain. A wrong guess here is harmless: it just
// won't match a real deployed contract when checked against the chain.
//
// The Argent/Ready entries below were reverse-engineered from a real deploy
// transaction on Sepolia (found by searching for AccountCreatedGuid events),
// not from Argent's public docs — their wallet fetches its current class
// hash from a private backend at runtime, so this is empirical, not
// documented. Two things about it aren't obvious from the account contract
// alone: Cairo's `Option<T>` enum is declared `Some, None`, so it Serde-
// encodes as tag 0 = Some, tag 1 = None (backwards from what you'd guess),
// and the salt is the public key.
const CANDIDATES: { classHash: string; calldata: (pub: string) => string[] }[] = [
  // Argent / Ready — constructor(owner: Signer, guardian: Option<Signer>).
  // calldata = [Signer::Starknet variant(0), pubkey, Option::None tag(1)]
  {
    classHash: "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f",
    calldata: (pub) => ["0x0", pub, "0x1"],
  },
  {
    classHash: "0x073414441639dcd11d1846f287650a00c60c416b9d3ba45d31c651672125b2c2",
    calldata: (pub) => ["0x0", pub, "0x1"],
  },
  // OpenZeppelin account — constructor(publicKey: felt252)
  {
    classHash: "0x05b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564",
    calldata: (pub) => [pub],
  },
  {
    classHash: "0x04c6d6cf894f8bc96bb9c525e6853e5483177841f7388f74a46cfda6f028c755",
    calldata: (pub) => [pub],
  },
];

export function deriveCandidates(privateKeyHex: string): AccountCandidate[] {
  const pubKey = ec.starkCurve.getStarkKey(privateKeyHex);
  const seen = new Set<string>();
  const candidates: AccountCandidate[] = [];

  for (const { classHash, calldata } of CANDIDATES) {
    try {
      const cd = calldata(pubKey);
      const address = hash.calculateContractAddressFromHash(pubKey, classHash, cd, 0);
      if (seen.has(address)) continue;
      seen.add(address);
      candidates.push({ address, classHash, calldata: cd, salt: pubKey });
    } catch {
      // a bad class hash / calldata shape just gets skipped
    }
  }

  return candidates;
}

export function deriveCandidateAddresses(privateKeyHex: string): string[] {
  return deriveCandidates(privateKeyHex).map((c) => c.address);
}
