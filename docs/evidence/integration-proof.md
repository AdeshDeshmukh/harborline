# Gateway integration proof register

**HL-06 / 24 November 2026 (IST): documentation research only.**
No provider customer, token, quote, order, signature, deposit, transfer or trade
was created in this audit. No live integration proof exists from this work.

## Evidence already available

- Official guide review: [API contracts](../api-contracts.md).
- Decisions, all seven Phase 0 questions and named blockers:
  [decision register](../decisions.md).
- Gateway OpenAPI downloaded from the official site: version 1.56.0;
  SHA-256 `bfbbf635338806d30d6b562615b164796c34505c814e01b9e152b3210f76d996`.
  Only the relevant authentication description, order/quote/payload, availability,
  restriction, balance and UAT/paper sections were inspected; this is not an
  exhaustive schema audit. Local temporary snapshot: `/tmp/hl06-gateway.yaml`;
  it is not a durable repository artifact.

## Evidence to collect in later authorized slices

| Stage | Sanitized evidence to retain | Current state |
| --- | --- | --- |
| Public route (HL-07) | Date/environment, listing ID, mint/address, chain, venue, class, status, quote currency and restriction rules | Local catalog/restriction observation collected: [record](hl-07-public-read.json), [interpretation](../public-provider-check.md). Quote currency and deployment-origin check remain unverified. |
| Access and eligibility | Confirmed organization access, supported pilot geography and onboarding method, provider guidance reference | Not verified |
| Account and recovery | Stable mapping, wallet chain, signer public-key match, backup/restore rehearsal and supported recovery procedure | Not verified |
| Prepared review | Actual response shape, nonempty order ID, venue, quote and fee units, bounded debit, payload digests, policy/review revision | Not collected |
| Execution | Separately authorized asset/amount/network, provider order ID, raw status, actual fill/fee, transaction correlation and explorer evidence where supplied | Not performed |
| Reconciliation | Owned balance observations, held/reserved treatment, settlement evidence and resolution of ambiguous outcomes | Not performed |
| Exit | Sell-back result, stablecoin balance and separately authorized return transfer if used | Not performed |

## Evidence rules

Label each record as documentation, fixture, public API observation, authenticated
read, or actual financial operation. Never promote one category into another.
Do not commit credentials, stamps, raw signed payloads, private customer records
or unredacted support exchanges. Use stable redacted references to correlate
records without exposing account details.

A later experiment needs a written bounded procedure, confirmed eligibility,
recovery and maximum debit, and separate authorization. An operator performs
financial confirmation. A successful buy alone does not prove exit or durable
cash reconciliation. This register is a collection plan, not permission to run it.
