# Durable fixture sale lifecycle — HL-28B

Status: local fixture implementation, 26 November 2026. This is the second of the
approved HL-28 slices. It does not establish live sell-back or fund return.

## Boundaries

All effects use injected fictional transport, snapshots and generated test keys.
The runtime has no sale preparation/approval/execution composition. POST
`/api/disposals/review` accepts only assetId, amount (base units), policyRevision
and an Idempotency-Key; it rejects client authority selectors. After request,
origin and session checks it returns integration_unverified (503), without account
bootstrap, provider reads or a database connection. No environment flag or API
key activates this route. No sale approval, withdrawal or transfer button exists.

A saved owner-only sale can be inspected at `/activity/:intentId` or
`/disposals/:intentId`; the existing owned investment-detail read API uses the
same safe projection. Reload reads saved data only. Public examples at
`/sample/activity/sale-complete` and `/sample/activity/sale-partial` contain fixed
fictional data and share the renderer; neither imports a database/provider client.

## Storage and versioning

Migration 0010 adds eight forced-RLS tables alongside the existing buy evidence:
reads, read observations, reviews, approvals, dispatches, send authorizations,
outcomes and settlements (all prefixed disposal_). Runtime app role has only
SELECT/INSERT on these evidence tables, plus the read sequence privilege. The
signer role has no sale evidence access. Composite account/intent/phase/review
links and a sale-only intent trigger reject cross-pipeline attachment.

Version-2 review terms bind the owner, account, original provider customer,
listing/address/precision, policy revision, intent generation and holding read.
A distinct SHA256 domain and AES-GCM additional-data domain isolate sale payloads.
Existing buy terms, ciphertext AAD and cash-debit constraints retain their meaning.

Both sides share investment_intents, the locked account row, reservation and
generic approval/execution protocol. A sale needs real owned holdings and exact
base precision, not a buying allowance or dummy calculation. Its approval cash
baseline may be zero. Stock amounts never occupy cash maximum-debit fields.

## State and authority

1. Claim the shared slot. Persist an owned prepare-read start, then canonical
   stock/cash observation. Persist the exact validated quote and encrypted unsigned
   payloads with REVIEW_READY and audit atomically. Before invoking preparation,
   validate available units/precision/atomic bounds and commit a read-bound
   authorization. Generic abandonment, cleanup, restart and rejection cannot
   release a pending callback; legacy buy completion cannot consume it. The
   existing possible-effects flag remains monotonic. Possible preparation effects
   retain uncertainty and the reservation; retry does not recreate the order.
2. Require explicit customer approval of the saved hash/revision and an independent
   trusted server operator in the allowlist. Recheck current mapping/policy and
   a newer fresh holding/cash read. Save approval, attempt and the actual cash
   baseline with SUBMITTING atomically. Buying commitments do not forbid a sale.
3. Claim one durable dispatch. Refresh and check holdings before signing, then
   refresh again after signing. Commit one send authorization; check controls and
   time again after awaited work. Shared executor decrypts only the bound payload.
   Replay never signs/sends again, including crashes with an unused claim.
4. Recover through durable order-read tickets. Newer authority is fenced by
   sequence, revision, generation, binding and slot. Late replies remain ignored
   history, not replacement truth. Conflicting terminal or regressing cumulative
   reports require review, including disagreements between known terminal
   economic values; missing actuals may later become known. Original send
   completion is separately durable. Failure to save a known POST result never
   substitutes an unknown result; clearance stays blocked until the same result
   is durably recorded.
5. Capture settlement balances only after latest accepted terminal actuals and
   completion of the original send callback. Bind the capture to that approval,
   order report and current cash-baseline ID. A later cash baseline or order check
   invalidates the capture. Unknown fees/fills/gross values cannot clear it.
6. Reconcile actual stock debit and actual fee-net USDC credit independently,
   allowing explicit unrelated movements on each side. Save the proof and exact
   post-cash baseline, release only this reservation and audit in one transaction.
   An audit/release failure rolls everything back. Proof replay cannot release a
   different operation's slot.

New preparation/approval/send/clearance requires fixture mode, enabled writes and
an allowed trusted operator. Authorized investigation can start order/settlement
reads while writes are paused; already-issued callbacks may persist despite a
pause/revocation so possible effects are not lost. Starting investigation still
requires operator authorization. None of this authenticates an HTTP operator or
establishes a production kill switch.

## Economics and presentation

A full fictional sale of 0.5 of 1 stock unit at 200 USDC/unit yields gross 100,
fee 0.5 and net credit 99.5: stock becomes 0.5 and zero starting cash becomes
99.5. A failed partial fill of 0.2 yields gross 40, fee 0.2 and credit 39.8;
0.3 remains unfilled. A failed/canceled status never means no assets moved.

The raw fixture normalizer requires exact sale/base/market/Solana/DeFi listing,
USDC quote and cash-fee asset. A known fee above known gross is conflicting
evidence; the saved review/approval remains readable. It derives gross only from known actual fill and
price with exact atomic precision, never estimated quote values. Zero-fill VWAP
becomes null. Unknown fee/price/gross remains unknown. This normalized contract
is not verified Gateway field semantics or a provider finality guarantee.

Browser DTOs explicitly project original review/approval, accepted actuals,
latest saved check and proof-linked stock/cash receipt. The quoted fee and
separate approved maximum fee are both visible, with fees deducted from proceeds. They exclude operator,
provider customer, keys, payloads, private binding/read IDs and raw proof metadata.
Receipt rebuilding validates immutable evidence at verification time; later plans,
balances or operations do not rewrite it. It is historical, not current buying
power. Stock/cash verification is separate from order status and return transfer.
No chain transaction link is invented from an order ID.

## Remaining acceptance gates

See [operations](operations.md) and [integration evidence](evidence/integration-proof.md).
Real eligibility/geography, provider read/quote/fee semantics, owner/operator
session composition, real authentication/database migration/deployment, funded
sale, recovery and exact-destination return still need separate verification and
specific authorization. Completing local fixtures is not full live HL-28 acceptance.

## Deferred database hardening

The version/kind CHECK currently extracts JSON text. Missing/JSON-null keys or a
string version can pass that database CHECK; canonical application writers and
strict terms/hash readers still require version 2 and sell. Tightening the typed
JSON constraint remains a follow-up. This does not grant malformed rows authority.

## Local verification

After one independent whole-change review and one regression-tested author fix
pass, 863 tests passed: 6 offline provider-script, 541 unit/contract and 316
isolated PostgreSQL. This includes pending-preparation release guards, invalid
quantity preflight, preserving a known POST status when persistence fails,
terminal economic conflicts, impossible fees, fee-ceiling display, and the signed
fixture approval → bound GET → partial canceled settlement → receipt journey.
Legacy buy tests and pinned pre-migration ciphertext compatibility also passed.

Lint, typecheck, production build, post-build typecheck and tracked/new-file
whitespace checks passed. Browser checks covered 360px/1280px, keyboard skip/focus,
signed-out private-route redirection and the updated fee ceiling. These checks
used fixed examples and fictional local evidence, with no real provider calls,
cloud migrations or funded operations. The deferred typed-JSON constraint above
remains explicit; passing local tests does not establish production readiness.
