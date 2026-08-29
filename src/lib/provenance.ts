// Where the vault's money actually came from, proven against the chain.
//
// The ledger is Aegis writing down its own work ("I swept 84 STRK out of this
// repo's leaked key"), so on its own it is a claim, not evidence. Two things
// go wrong if claims are paid straight off it:
//
//   1. A line nobody ever checked. Nothing re-reads the tx hash, so a rescue
//      that reverted, or was written twice, or never landed, still counts.
//   2. The same money counted again every lap. Send STRK from the vault back
//      to a leaked account to re-test the sweep and the bot rescues it again,
//      adding the full amount to the ledger a second time — no new funds were
//      recovered, but "rescued" grows. Sepolia has 800 STRK of exactly this.
//
// So each record is verified against its receipt (real tx, SUCCEEDED, and a
// STRK Transfer of that amount into the safe wallet), and whatever the vault
// sent back out to those same accounts is subtracted. What survives is
// `attributable`: funds in the vault traceable to a leak in a specific GitHub
// repo. Only that is claimable.

import { RPC_URL, SAFE_WALLET, STRK_TOKEN, type Network } from "./networks";
import { getLedger, type RescueRecord } from "./ledger";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// keccak("Transfer"), the ERC-20 event key on Starknet.
const TRANSFER_KEY = "0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9";

// Amounts are floats derived from the same wei value on both sides, so they
// should match to the bit — this only absorbs float noise, not a real gap.
const AMOUNT_TOLERANCE = 1e-9;

// Addresses whose money was never a victim's. A leak funded from one of these
// is a drill: the STRK came from Aegis itself, or from a faucet that hands it
// out for free, so sweeping it recovered nothing and nobody is owed it back.
// On-chain the two are identical — a victim topping up a wallet whose key
// leaked looks exactly like us topping up a test one — so the only way Aegis
// can tell them apart is to know its own addresses.
// Deliberately empty. A faucet was in here, and it was the wrong call: the
// faucet hands STRK to the wallet's owner, so that money is theirs like any
// other. Where it came from doesn't decide who it belongs to — the leaked
// wallet does. What still belongs here is money that was never anyone's but
// Aegis's, which is why the safe wallet stays in the list below: STRK the
// vault sends a leaked account and then sweeps back was never the owner's,
// and counting it would let the vault inflate what it owes by paying itself.
const KNOWN_FAUCETS: Record<Network, string[]> = {
  sepolia: [],
  mainnet: [],
};

// Repositories to treat as drills: rescued from a leak that was planted rather
// than lost, reported in full but never claimable. Empty by default — a repo's
// verified owner is the rightful claimant of whatever was in their wallet, and
// that holds for our own repo too. This stays as a switch for a fixture that
// genuinely shouldn't be claimable by anyone.
const SELF_TEST_REPOS = (process.env.SELF_TEST_REPOS ?? "")
  .split(",")
  .map((r) => r.trim().toLowerCase().replace(/\/+$/, ""))
  .filter(Boolean);

export function isSelfTestRepo(repoUrl: string): boolean {
  return SELF_TEST_REPOS.includes(repoUrl.trim().toLowerCase().replace(/\/+$/, ""));
}

function nonVictimFunders(network: Network): string[] {
  const configured = (process.env.NON_VICTIM_FUNDERS ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  const safe = SAFE_WALLET[network];
  return [...(safe ? [safe] : []), ...KNOWN_FAUCETS[network], ...configured];
}

// How far before the first known rescue to look for non-victim funding.
// Such funding only matters if the bot later swept it back, so the window that
// counts starts around the first sweep; the margin covers funding sent shortly
// before it. Sepolia runs ~50k blocks/day, so this is a few days of slack.
const FUNDING_LOOKBACK_MARGIN = 200_000;

// What the chain says about one rescue tx, cached under its hash. Only facts
// live here, never a verdict: a mined tx never changes its mind, but whether
// it backs a given ledger line depends on that line, and two lines can point
// at the same hash.
interface ChainFacts {
  found: boolean;
  succeeded: boolean;
  blockNumber: number | null;
  /** STRK this tx moved into the safe wallet. */
  intoVault: number;
  /** Sender of that transfer — the leaked account the funds came out of. */
  from: string | null;
}

export interface RescueProof {
  txHash: string;
  repoUrl: string;
  network: Network;
  amount: number;
  verified: boolean;
  accountAddress: string | null;
  blockNumber: number | null;
  observedAmount: number | null;
  /** File in the repo the key was found in, when the rescue recorded one. */
  sourceFile?: string;
  /** The chain couldn't be reached — unproven for now, but not disproven. */
  unreachable?: boolean;
  reason?: string;
}

export interface RepoProvenance {
  repoUrl: string;
  network: Network;
  /** Rescued STRK proven on-chain. */
  verified: number;
  /** Ledger amounts whose tx could not be proven — never claimable. */
  unverified: number;
  /** STRK that reached this repo's leaked accounts from Aegis or a faucet. */
  selfFunded: number;
  /** Aegis planted this leak itself — a drill, never claimable. */
  selfTest: boolean;
  /** verified − selfFunded, floored at 0, and 0 for a drill. The only claimable figure. */
  attributable: number;
  proofs: RescueProof[];
}

export interface NetworkProvenance {
  /** True when the chain couldn't be read in full, so these numbers are held back. */
  partial: boolean;
  /** Rescued from leaks Aegis planted itself — reported, never claimable. */
  selfTestTotal: number;
  verified: number;
  unverified: number;
  selfFunded: number;
  attributable: number;
  repos: RepoProvenance[];
}

// "The node answered and said no" and "the node didn't answer" have to stay
// apart here. The first is evidence; the second is a network blip, and treating
// it as evidence would quietly wipe an owner's claimable balance for as long as
// the answer stayed cached.
type RpcOutcome<T> = { answered: true; result: T | null } | { answered: false; result: null };

async function rpc<T>(network: Network, method: string, params: unknown): Promise<RpcOutcome<T>> {
  const url = RPC_URL[network];
  if (!url) return { answered: false, result: null };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) return { answered: false, result: null };
    const json = await res.json();
    if (json.error) return { answered: true, result: null };
    return { answered: true, result: json.result as T };
  } catch {
    return { answered: false, result: null };
  }
}

function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

/** Normalised key for address-to-amount maps — 0x9042… and 0x009042… are one address. */
function addressKey(a: string): string {
  try {
    return BigInt(a).toString(16);
  } catch {
    return a.toLowerCase();
  }
}

function u256ToStrk(low: string, high?: string): number {
  const value = BigInt(low) + (BigInt(high ?? "0x0") << 128n);
  return Number(value) / 1e18;
}

async function kvGet(key: string): Promise<string | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await res.json();
    return typeof data.result === "string" ? data.result : null;
  } catch {
    return null;
  }
}

// The value goes in the body rather than the path: an assembled provenance
// answer is kilobytes of JSON, well past what belongs in a URL.
async function kvSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return;
  const suffix = ttlSeconds ? `?EX=${ttlSeconds}` : "";
  try {
    await fetch(`${KV_URL}/set/${encodeURIComponent(key)}${suffix}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      body: value,
    });
  } catch {
    // a cache that fails to write is just a slower next call
  }
}

// One round trip for every cached transaction instead of one per record — the
// vault endpoint is polled every 20s, and a read per ledger line adds up to
// tens of thousands of KV requests a day for answers that never change.
async function kvGetMany(keys: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (!KV_URL || !KV_TOKEN || keys.length === 0) return found;
  try {
    const res = await fetch(`${KV_URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(keys.map((k) => ["get", k])),
    });
    const data = await res.json();
    if (!Array.isArray(data)) return found;
    data.forEach((entry: { result?: unknown }, i: number) => {
      if (typeof entry?.result === "string") found.set(keys[i], entry.result);
    });
  } catch {
    // no cache is just a slower rebuild
  }
  return found;
}

interface Receipt {
  execution_status?: string;
  block_number?: number;
  events?: { from_address: string; keys: string[]; data: string[] }[];
}

// Reads one rescue transaction: did it happen, did it succeed, how much STRK
// did it put in the vault, and who sent it. The sender is the leaked account,
// which is how a rescue ties back to the key found in the repo.
async function readChain(network: Network, txHash: string): Promise<ChainFacts | null | undefined> {
  const safe = SAFE_WALLET[network];
  if (!safe) return null;

  const outcome = await rpc<Receipt>(network, "starknet_getTransactionReceipt", [txHash]);
  if (!outcome.answered) return undefined;
  const receipt = outcome.result;
  if (!receipt) return { found: false, succeeded: false, blockNumber: null, intoVault: 0, from: null };

  const blockNumber = receipt.block_number ?? null;
  if (receipt.execution_status !== "SUCCEEDED") {
    return { found: true, succeeded: false, blockNumber, intoVault: 0, from: null };
  }

  let intoVault = 0;
  let from: string | null = null;
  for (const event of receipt.events ?? []) {
    if (!sameAddress(event.from_address, STRK_TOKEN)) continue;
    if (!sameAddress(event.keys[0], TRANSFER_KEY)) continue;
    if (!sameAddress(event.keys[2], safe)) continue;
    intoVault += u256ToStrk(event.data[0], event.data[1]);
    from = from ?? event.keys[1];
  }
  return { found: true, succeeded: true, blockNumber, intoVault, from };
}

function factsKey(network: Network, txHash: string): string {
  return `aegis:txfacts:${network}:${txHash}`;
}

async function chainFacts(
  network: Network,
  txHash: string,
  cached: Map<string, string>,
): Promise<ChainFacts | null | undefined> {
  const key = factsKey(network, txHash);
  const hit = cached.get(key);
  if (hit) {
    try {
      return JSON.parse(hit) as ChainFacts;
    } catch {
      // corrupt cache entry — fall through and re-read the chain
    }
  }

  const facts = await readChain(network, txHash);
  if (!facts) return facts;
  // A mined transaction is settled for good; a miss might just be a tx that
  // hasn't been indexed yet, so don't let that stick.
  await kvSet(key, JSON.stringify(facts), facts.found ? undefined : 300);
  return facts;
}

// A ledger line is proven when a real, successful transaction moved exactly
// that much STRK into the vault — and, for rescues that recorded which account
// they swept, when the transaction's sender is that same account.
async function verifyRecord(record: RescueRecord, cached: Map<string, string>): Promise<RescueProof> {
  const base = {
    txHash: record.txHash,
    repoUrl: record.repoUrl,
    network: record.network,
    amount: record.amount,
    sourceFile: record.sourceFile,
    accountAddress: record.accountAddress ?? null,
    blockNumber: null as number | null,
    observedAmount: null as number | null,
  };

  const facts = await chainFacts(record.network, record.txHash, cached);
  if (facts === undefined) return { ...base, verified: false, unreachable: true, reason: "could not reach the chain to check this" };
  if (!facts) return { ...base, verified: false, reason: "no safe wallet configured for this network" };
  if (!facts.found) return { ...base, verified: false, reason: "transaction not found on chain" };

  const seen = { ...base, blockNumber: facts.blockNumber, accountAddress: facts.from ?? base.accountAddress, observedAmount: facts.intoVault };
  if (!facts.succeeded) return { ...seen, verified: false, reason: "transaction did not succeed" };
  if (facts.intoVault <= 0) {
    return { ...seen, verified: false, reason: "no STRK transfer into the vault in this transaction" };
  }
  if (Math.abs(facts.intoVault - record.amount) > AMOUNT_TOLERANCE) {
    return { ...seen, verified: false, reason: `ledger says ${record.amount} STRK, chain says ${facts.intoVault}` };
  }
  if (record.accountAddress && !sameAddress(record.accountAddress, facts.from)) {
    return { ...seen, verified: false, reason: "transaction was not sent by the account this rescue recorded" };
  }
  return { ...seen, verified: true };
}

// Every STRK that left an address whose money isn't a victim's — the vault
// itself, a faucet, any address the operator has declared — with the block it
// landed in. Only the ones that landed on an account Aegis later swept matter;
// the rest (shielding into the privacy pool, paying out a claim, ordinary
// faucet traffic to strangers) has nothing to do with what's claimable.
async function nonVictimTransfers(
  network: Network,
  fromBlock: number,
): Promise<{ transfers: { to: string; amount: number; block: number }[]; complete: boolean }> {
  const funders = nonVictimFunders(network);
  const transfers: { to: string; amount: number; block: number }[] = [];
  if (funders.length === 0) return { transfers, complete: false };
  let complete = true;

  let continuationToken: string | undefined;
  let pages = 0;
  do {
    const outcome = await rpc<{ events: { keys: string[]; data: string[]; block_number?: number }[]; continuation_token?: string }>(
      network,
      "starknet_getEvents",
      [
        {
          from_block: { block_number: Math.max(0, fromBlock) },
          to_block: "latest",
          address: STRK_TOKEN,
          keys: [[TRANSFER_KEY], funders],
          chunk_size: 1000,
          ...(continuationToken ? { continuation_token: continuationToken } : {}),
        },
      ],
    );
    if (!outcome.answered || !outcome.result) {
      complete = false;
      break;
    }
    const result = outcome.result;
    for (const event of result.events) {
      transfers.push({
        to: addressKey(event.keys[2]),
        amount: u256ToStrk(event.data[0], event.data[1]),
        block: event.block_number ?? Number.MAX_SAFE_INTEGER,
      });
    }
    continuationToken = result.continuation_token;
    pages++;
  } while (continuationToken && pages < 40);

  // Stopping early leaves non-victim funding unaccounted for, which would
  // overstate what is claimable — the one direction never to guess at.
  if (continuationToken) complete = false;
  return { transfers, complete };
}

async function buildNetwork(
  network: Network,
  ledger: RescueRecord[],
  cached: Map<string, string>,
): Promise<NetworkProvenance> {
  const records = ledger.filter((r) => r.network === network);
  const proofs = await Promise.all(records.map((r) => verifyRecord(r, cached)));

  const blocks = proofs.filter((p) => p.verified && p.blockNumber !== null).map((p) => p.blockNumber as number);
  const scan = blocks.length > 0
    ? await nonVictimTransfers(network, Math.min(...blocks) - FUNDING_LOOKBACK_MARGIN)
    : { transfers: [], complete: true };

  // The last block on which each account was swept. Money the vault sent an
  // account after that is still sitting there — it hasn't been rescued a second
  // time, so it hasn't been counted a second time and there's nothing to
  // subtract yet. This is also what keeps a payout to an owner who reuses the
  // compromised wallet from being mistaken for its funding.
  const lastSweep = new Map<string, number>();
  for (const proof of proofs) {
    if (!proof.verified || !proof.accountAddress || proof.blockNumber === null) continue;
    const key = addressKey(proof.accountAddress);
    lastSweep.set(key, Math.max(lastSweep.get(key) ?? 0, proof.blockNumber));
  }

  const selfFunding = new Map<string, number>();
  for (const transfer of scan.transfers) {
    const swept = lastSweep.get(transfer.to);
    if (swept === undefined || transfer.block > swept) continue;
    selfFunding.set(transfer.to, (selfFunding.get(transfer.to) ?? 0) + transfer.amount);
  }
  // Anything unread — a receipt we couldn't fetch, a funding scan that stopped
  // short — means the picture is incomplete, so nothing here is offered up as
  // claimable until it can be read properly. It self-heals on the next request,
  // since a partial answer is never cached.
  const partial = !scan.complete || proofs.some((p) => p.unreachable);

  const byRepo = new Map<string, RescueProof[]>();
  for (const proof of proofs) {
    const list = byRepo.get(proof.repoUrl) ?? [];
    list.push(proof);
    byRepo.set(proof.repoUrl, list);
  }

  // An account belongs to one repo — whichever repo's proofs name it first, in
  // a stable order — so funding can never be subtracted twice.
  const claimedAccounts = new Set<string>();
  const repos: RepoProvenance[] = [];
  for (const repoUrl of [...byRepo.keys()].sort()) {
    const repoProofs = byRepo.get(repoUrl) as RescueProof[];
    const verified = repoProofs.filter((p) => p.verified).reduce((sum, p) => sum + p.amount, 0);
    const unverified = repoProofs.filter((p) => !p.verified).reduce((sum, p) => sum + p.amount, 0);

    let selfFunded = 0;
    for (const proof of repoProofs) {
      if (!proof.verified || !proof.accountAddress) continue;
      const key = addressKey(proof.accountAddress);
      if (claimedAccounts.has(key)) continue;
      claimedAccounts.add(key);
      selfFunded += selfFunding.get(key) ?? 0;
    }

    const selfTest = isSelfTestRepo(repoUrl);
    repos.push({
      repoUrl,
      network,
      verified,
      unverified,
      selfFunded,
      selfTest,
      attributable: partial || selfTest ? 0 : Math.max(0, verified - selfFunded),
      proofs: repoProofs,
    });
  }

  const sum = (pick: (r: RepoProvenance) => number) => repos.reduce((total, r) => total + pick(r), 0);
  return {
    partial,
    selfTestTotal: repos.filter((r) => r.selfTest).reduce((total, r) => total + r.verified, 0),
    verified: sum((r) => r.verified),
    unverified: sum((r) => r.unverified),
    selfFunded: sum((r) => r.selfFunded),
    attributable: sum((r) => r.attributable),
    repos,
  };
}

// Proving the whole ledger costs one receipt call per record plus one event
// scan per network, so the assembled answer is cached rather than the pieces:
// in-process first, then in KV so a cold instance — and every other instance —
// skips the work too. A rescue that lands mid-window shows up on the next
// rebuild, which is soon enough for a claim that is paid out by hand.
const CACHE_KEY = "aegis:provenance";
const CACHE_TTL_S = 120;
const MEMO_TTL_MS = 60_000;

let memo: { at: number; value: Record<Network, NetworkProvenance> } | null = null;

export async function getProvenance(): Promise<Record<Network, NetworkProvenance>> {
  if (memo && Date.now() - memo.at < MEMO_TTL_MS) return memo.value;

  const shared = await kvGet(CACHE_KEY);
  if (shared) {
    try {
      const value = JSON.parse(shared) as Record<Network, NetworkProvenance>;
      memo = { at: Date.now(), value };
      return value;
    } catch {
      // corrupt cache entry — rebuild it
    }
  }

  const ledger = await getLedger();
  const cached = await kvGetMany(ledger.map((r) => factsKey(r.network, r.txHash)));
  const [mainnet, sepolia] = await Promise.all([
    buildNetwork("mainnet", ledger, cached),
    buildNetwork("sepolia", ledger, cached),
  ]);
  const value = { mainnet, sepolia };
  if (mainnet.partial || sepolia.partial) return value;
  memo = { at: Date.now(), value };
  await kvSet(CACHE_KEY, JSON.stringify(value), CACHE_TTL_S);
  return value;
}
