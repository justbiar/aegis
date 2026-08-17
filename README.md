# Aegis

A whitehat rescue service for exposed on-chain funds on Starknet.

## What it does

Aegis continuously scans public repositories for accidentally committed secrets (private keys, seed phrases, credentials) that control funds. When it finds a live one, it sweeps the exposed balance into a Starknet STRK20 shielded position before a malicious actor can — the destination is private, so the rescued funds can't be traced and re-drained.

The original owner recovers their funds by proving control of the leaking GitHub repository. Verified owners get their balance back in full; Aegis takes nothing.

This turns a privacy pool into a safe box for people who leak keys by accident — "vibe coders" shipping fast without a security background being the primary audience.

## Why it needs privacy

A sweep-and-return service is only as safe as its own holding address. A transparent holding wallet is itself a target: anyone watching the mempool can front-run the rescue or drain the safe address the moment it's known. Routing rescued funds through the STRK20 shielded pool removes that window — the holding balance isn't linkable on-chain, and payout to a verified owner is a private transfer rather than a public, front-runnable transaction.

## Status

Early build, part of the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon).

## How to run locally

```bash
npm install
cp .env.example .env.local     # add your Alchemy Starknet RPC key
npm run dev                    # http://localhost:3000
```

Scanner and claim-verification service are in progress.

## Credits

UI built on top of the [STRK20 starter kit](https://github.com/Akashneelesh/strk20-starter-kit) (MIT).

## License

MIT, see [LICENSE](LICENSE).
