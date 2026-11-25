# Durable investment reviews — HL-21

## Current authority

This slice adds immutable review terms, encrypted unsigned payload storage, a fixture preparation service, and POST `/api/investments/review`. It does not enable real preparation, signing or trading. Every returned review has `source: contract_fixture`, `canApprove: false` and `canExecute: false`.

The runtime endpoint validates origin, bounded JSON, the idempotency key and a verified session, then returns `503 integration_unverified`. It does not bootstrap an account, initialize a database/client, or call Gateway. There is no environment switch that enables this path. Injected test dependencies exercise the service separately; they are not live provider evidence.

HL-18 eligibility/customer/geography and HL-19 maximum-debit/expiry gates remain unresolved. The official [place-order guide](https://docs.truemarkets.co/gateway/place-orders/) and [signing guide](https://docs.truemarkets.co/gateway/requests-and-signing/) were read on 25 November 2026. Payloads must retain their exact UTF-8 text, order and trailing newline. The previously inspected OpenAPI v1.62.0 also describes immediate submission paths and paper behavior; fixture success does not resolve environment-specific guarantees. No live order experiment was performed.

## Workflow and concurrency

The internal service accepts the existing seven-field normalized intent command. Only buys with quote sizing and an owned calculation are supported here; sell-back belongs to HL-28.

1. Claim the account slot with HL-20 request-key deduplication. A replay returns the original intent and saved review without a provider mutation, including when the original request is PREPARING or UNKNOWN.
2. Load the owned calculation/balance and ready account mapping under a short account lock. Validate current policy, timezone/local date, latest balance, source/route and a maximum 15-second observation age.
3. Obtain fixture asset metadata, validate the Solana stock/native-USDC route, and reject an excessive request before preparing. A failure while still DRAFT abandons only that matching unstarted intent.
4. After awaited asset metadata, recheck the owned basis and ready mapping in the same locked transaction that enters PREPARING with a generation and 30-second lease. A stale DRAFT is safely abandoned without dispatch. Release the transaction before the injected transport call.
5. Force `venue: defi`, `chain: solana`, market buy, quote units and the selected asset ID. The adapter has no default transport and rejects provider mode before making a request. It never retries a mutation.
6. Normalize the response, verify ordered payload digests and exact text, assess explicit fixture debit/fee/expiry evidence, then persist the review, READY transition and audit in one transaction.

Persistence rechecks slot, revision, generation, PREPARING state, lease, policy, latest balance, source, date/timezone, asset/amount and quote-currency listing. There is no network work inside these transactions. A superseded response is audited but cannot create a review, restore an old state or take another intent's slot.

The preparation-time balance check is not approval authority. HL-23/24 must refresh and validate owned inputs again before any eventual signature or execution.

## Immutable storage and hashing

Migration `0005_order_reviews.sql` creates `order_reviews` with forced owner RLS, an intent/account composite foreign key, and unique `(intent_id, revision)`. Revision is the preparation generation. App access is SELECT/INSERT only; signer/public roles cannot access the table. Older migrations and snapshots remain unchanged.

Each record contains normalized terms, their hash, maximum debit, encrypted payloads, nonce/tag/key version, creation time and local expiry. Database checks bound JSON/ciphertext sizes, decimal precision and the 20-second local review lifetime. Existing dangling account slots still fail the prior migration rather than being silently cleared.

Replay responses read intent state and review together under one account lock, so completion cannot produce a READY response with a review fetched before completion. The versioned terms hash binds:

- Account, intent, preparation generation, policy revision and calculation.
- Provider order reference and explicit fixture contract reference.
- Stock and cash listing identity, chain, venue, quantity, output, fees and quote observation/fingerprint.
- Verified fixture maximum debit, fee treatment and local expiry.
- Cash before/after maximum debit, planned commitments, buffer and debit budget.
- Every payload digest in its signing order.

The before/after explanation uses the maximum debit, including its assessed fee treatment. It does not claim that provider estimates are enforceable live bounds.

Payload text is encrypted with AES-256-GCM, a random 12-byte nonce and a separate injected 32-byte key. Associated data binds account, intent, generation, calculation, policy, terms hash and key version. Payload SHA-256 digests are checked before sealing and after opening. Caller mutation of the original encryption-key Buffer does not change the vault's key copy.

No live encryption key is configured or generated by a route. A future deployment must provision this separately from signer keys, preserve required versions for recovery and define controlled payload retention. No automatic deletion or rotation is introduced here. Database immutability is an application-role guarantee, not administrator-proof evidence.

Browser projections contain the buy discriminator, stored fee treatment, fixture blocking reason, terms, cash impact, expiry and disabled authority flags. They omit plaintext/ciphertext payloads, authentication tokens and encryption/signer material. A terms hash is correlation and integrity data, not user approval.

## Outcomes and recovery

| Observation | Local result |
| --- | --- |
| Initialized DeFi, valid ID/payloads/quote, bounded fixture terms and current inputs | Save immutable review and mark REVIEW_READY |
| Empty ID, explicit quote issues and empty/omitted payloads in the fixture contract | REJECTED; release only the matching unsigned slot |
| Wrong venue, immediate execution, absent/malformed payloads or unsupported response | UNKNOWN incident; retain slot and bounded provider reference when valid |
| Lost response/transport failure | UNKNOWN incident; no automatic second preparation |
| Invalid/excessive terms after a response | UNKNOWN incident; retain reference and slot |
| Late generation, expired lease or superseded slot | Audit observation; do not overwrite or release |
| Failed review insert, transition or audit write | Roll back the entire review transaction |

All preparation outcomes, including quote-only refusals, check generation/revision/slot and lease before changing an unsigned state. Late refusals are audited without releasing or replacing a slot. Explicit fixture cleanup may independently expire unsigned work under HL-20 rules.

Incident references are observations, not verified unique intent mappings. They are retained in the incident audit without assigning the intent's unique provider-order column. Thus an ID already associated with another intent cannot roll back uncertainty tracking: the current intent still becomes UNKNOWN with possible effects and keeps its slot. Future reconciliation must inspect these audit references, verify ownership/correlation and resolve collisions before creating an authoritative mapping.

UNKNOWN never becomes a new attempt because of lease age. Unexpected execution is not shown as a normal review. HL-24/26 must reconcile authoritative provider outcomes and settlement before releasing financial slots. Full provider status/fill projections and reconciliation workers remain later work.

## HTTP contract

POST `/api/investments/review` accepts exactly `{assetId, amount, policyRevision, calculationId}` with `Idempotency-Key`. It derives owner identity server-side and maps the request to the normalized intent command. Request JSON is limited to 4096 bytes; cross-site Origin, query strings, unsupported media types, extra identity/payload fields and invalid quantities are rejected. Responses use private/no-store headers and bounded errors with generated request IDs.

The default composition remains disabled even when account credentials or environment flags exist. Fixture injection is server-side test composition only. No approval endpoint or execute adapter is added.

## Verification and next boundary

Tests exercise exact payload preservation, digest/AEAD tampering, ordered terms hashing, encryption context isolation, forced routing, provider-mode denial, no mutation retry, HTTP guards, owner isolation, immutable grants, atomic rollback, stale inputs, duplicate/concurrent requests, quote-only refusals, malformed/immediate outcomes and uncertainty retention using real disposable PostgreSQL plus offline fixtures.

No live customer, private balance/quote, real prepare, signature, trade, deployed database or migration was exercised. HL-22 owns review UI; HL-23/24 own approval and execution authority. Local lifecycle helpers and fixture terms must not be treated as completion of those gates.
