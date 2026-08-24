// Repo-name masking, kept in its own dependency-free module so the client
// console and the server scanners share one implementation. The console has to
// mask a repo name the same way the scanner did in order to match a flagged
// entry against its node, so the two must never drift apart — and importing
// this from scan.ts would drag starknet.js and the rescue path into the
// browser bundle.
//
// Why anything is masked at all: an exposure found on testnet is the same key
// on mainnet, since the scanner derives the same address on both chains. So
// naming a repo that is flagged but not yet swept points an attacker straight
// at live funds — the opposite of what a project built around an unlinkable
// holding position should publish.
//
// One-way and applied before anything is stored, because the epoch feed is a
// public endpoint; masking only at render time would leave the real names one
// curl away. It narrows rather than hides: someone holding the repo list could
// still match a pattern, so this is a speed bump on top of not publishing, not
// a guarantee.
export function maskRepo(repo: string): string {
  return repo
    .split("/")
    .map((part) => (part.length <= 1 ? part : part[0] + "*".repeat(Math.min(part.length - 1, 6))))
    .join("/");
}
