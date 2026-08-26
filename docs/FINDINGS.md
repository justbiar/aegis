# Field notes on STRK20 and Starknet accounts

Things that cost us hours and aren't written down anywhere else. Every claim
here was verified against mainnet, and the check that verifies it is included
so you don't have to take our word for it.

Pool addresses used throughout:

| Network | STRK20 pool |
|---|---|
| mainnet | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| sepolia | `0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |

---

## 1. The pool fee is per call, not per transfer

`get_fee_amount()` returns a flat **6 STRK**, and `collect_fee()` runs **once
per `apply_actions` call** — not once per action inside it. Ten private
transfers bundled into a single `apply_actions` cost 6 STRK total; ten
separate calls cost 60.

```bash
curl -s -X POST "$RPC" -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"starknet_call","params":[{
    "contract_address":"0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
    "entry_point_selector":"0x3d323cd692ad43935b81ce230c47bfc57f69656249c5a33fe5223c17dd32ed2",
    "calldata":[]},"latest"]}'
# => ["0x53444835ec580000"]  == 6 * 10^18
```

The same hex constant shows up as an STRK transfer event in the fee-collection
step of a real shield transaction —
[`0x04f38014…57334ce`](https://voyager.online/tx/0x04f380142e7241278a90d5402a1dc8463a89dc8c58a12615b1f17304857334ce) —
so the getter and the chain agree.

**Why it matters:** if you're paying out to many recipients, batch them. We
pay every pending claim in one `strk20InvokeTransaction([...n transfers])` and
pay a single 6 STRK fee. No extra contract is needed for this — `apply_actions`
already takes an array.

The trade-off: a batch is all-or-nothing. One bad action reverts the whole
transaction, so filter recipients *before* you build the batch (see §2). And a
payout smaller than the fee can never be economical on its own — we prorate the
6 STRK across the claims in a batch rather than pretending it's free.

Some docs floating around say the fee is 4 STRK. It isn't, at least not on
mainnet today. Read it from the contract.

## 2. You can read registration status straight off the chain

`NOT_REGISTERED` is the error everyone hits, and it's ambiguous: it can mean
the **sender** isn't registered, or that a **recipient** isn't. The pool needs
the recipient's published viewing key to encrypt their note, so an unregistered
recipient fails a transfer that is otherwise perfectly valid.

You don't have to guess. `get_public_key(address)` returns the published
viewing key, or `0x0` if that address has never registered:

```bash
# selector for get_public_key
# 0x1a35984e05126dbecb7c3bb9929e7dd9106d460c59b1633739a5c733a5fb13b
# registered address   => 0x2a85f5a37d432770d38849d39572b3f6d9aa3c50f0ced098870b9b55a53744a
# never-registered     => 0x0
```

Check the sender and every recipient before submitting. It turns a cryptic
revert into a precise message, and combined with §1 it lets you drop the
unregistered recipients from a batch instead of losing the whole transaction.

Registration is **per network**. An address registered on mainnet is not
registered on Sepolia — that alone explained a `NOT_REGISTERED` that made no
sense to us for an afternoon.

## 3. Registration has to happen before deposit, and only a wallet can do it

The obvious idea — have the dapp send a `deposit` to register the user in one
click — does not work. It reverts with `NOT_REGISTERED`.

The reason is ordering: a deposit creates a note encrypted to the depositor's
viewing key, so that key has to already be published. Registration is where the
key gets generated and published, and that step happens inside the wallet's own
Shield flow, not in anything you can send with
`strk20InvokeTransaction([deposit])`.

So the practical shape of a dapp is: detect with `get_public_key`, and when it
returns `0x0`, send the user to their wallet's native Shield once. After that
your own pool calls work normally.

## 4. A headless signer cannot shield at all

If you hold a raw private key with no wallet — a backend, a bot, a keeper — you
cannot deposit into the pool. Deposit requires a signature from the compliance
screening partner (`SCREENING_PARTNER_SECRET`), and that signature only comes
through the wallet route. This was confirmed independently on live chain by
another sprint team (`ahmetenesdur/kese`), and it matches the pool ABI: there is
no separate register/deposit entrypoint, everything goes through
`apply_actions`, and proof is mandatory.

Standing up your own prover does **not** solve this. It's 600GB+ of
infrastructure and it would only let you transfer or withdraw notes that are
*already* shielded — the deposit leg still needs the screening signature, and
at the time of writing the mainnet proving service URL isn't published anyway.

**Consequence for anything automated:** the shielding step is manual by
necessity today. Design for that rather than discovering it late. In our case
the sweep is fully automatic and only the payout leg waits on a connected
wallet.

## 5. The fee for a private transfer comes out of your *shielded* balance

Ready's "Select fee token" screen lists only shielded tokens — Shielded
Starknet, Shielded ETH, and so on. Public STRK and ETH never appear there.

We lost time sending public ETH to the wallet trying to fix a fee error. That
was never going to work. The account had $0.028 of shielded STRK and the fee was
~$0.17. The fix is to shield a few STRK from the wallet's native Shield, so the
shielded balance can cover it.

## 6. A private key does not determine an address on Starknet

Unlike EVM chains, there is no key → address function. The address depends on
`class_hash`, `constructor_calldata` and `salt`, so recovering the account
behind a leaked key means knowing which wallet contract deployed it.

Argent/Ready's current class hash isn't documented publicly — the wallet fetches
it from a private backend at runtime. We found it by locating a real
`AccountCreatedGuid` event on chain and reading the calldata of the actual
`DEPLOY_ACCOUNT` transaction:

```
class_hash  0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f  (Argent 0.4.0)
constructor (owner: Signer, guardian: Option<Signer>)
calldata    [0x0, pubkey, 0x1]
            ^^^^         ^^^^
            Signer::Starknet variant   Option::None
```

That last field is a trap. Cairo's `Option<T>` is declared `Some, None` in that
order, so the serde tag is **0 = Some, 1 = None** — the opposite of what most
people assume. `0x1` here means *no guardian*.

Class hashes are the same on mainnet and Sepolia, so derivation code is
network-independent.

## 7. Compare addresses as numbers, never as strings

`0x9042...` and `0x009042...` are the same address and different strings. Every
comparison should go through `BigInt`. This bites in claim matching, event
filtering, and anywhere you compare an address from an RPC response against one
from config.

Related: STRK and ETH have the **same** token address on mainnet and Sepolia
(same class, same salt), but USDC, USDT, WBTC and wstETH do **not** — those are
separately deployed bridge contracts with different addresses per network, and
DAI has no Sepolia bridge at all. Take the addresses from
[`starknet-io/starknet-addresses`](https://github.com/starknet-io/starknet-addresses)
rather than assuming.

## 8. What is and isn't visible on a private transfer

Useful when you're deciding what your backend can verify.

A private in-pool transfer hides the sender, the recipient, the token and the
amount. It also hides the *account* that sent it: the `sender_address` on the
receipt is pool-internal (`0x10eb4fb3…`), not the wallet that signed. What stays
public is that the pool was touched, and when.

So a server cannot confirm "my safe wallet paid this specific claim" from the
chain. The only thing it can check is that the transaction succeeded and emitted
an event whose `from_address` is the pool. Anything stronger has to come from
authenticating the caller instead. We gate that endpoint on an admin session for
exactly this reason — it's bookkeeping, and no funds move through it.

One more consequence that surprises recipients: a private payout lands in the
receiver's **shielded** balance. It does not show up in their public wallet
balance at all. If you're building a payout flow, say so in the UI, or your
users will think the payment failed.

---

MIT, same as the rest of this repository. If any of this saves you an
afternoon, that was the point.
