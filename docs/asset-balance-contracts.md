# Asset and balance read contracts — HL-18 local foundation

## Status and scope

This is the local, gated portion of HL-18. It implements and tests catalog identity, restrictions, backend availability, customer-bound balance reads, funding-preview rules, and the existing allowance-calculation connection. **Full live HL-18 is not complete.** Its prerequisite — a confirmed backend method for end-user geography/eligibility — remains unresolved, as do the supported stock/USDC quote relationship and operational funding/recovery gates.

The runtime GET routes `/api/assets` and `/api/account/balance` independently verify the session without bootstrapping local database records, then return `integration_unverified` (503) for authenticated users. Anonymous users receive 401. No environment flag enables their live composition. Queries selecting accounts, provider users, countries, or assets are rejected. No API key, customer balance, wallet creation, funding, quote, order, signature, transfer, or deployment was used in this work.

The planning interface still uses its explicit fictional balance. It has not been silently switched to provider data. A caller cannot submit eligibility evidence or provider identities to these GET routes.

## Current primary-source evidence

Reviewed 25 November 2026:

- [Official Gateway specification](https://docs.truemarkets.co/openapi/gateway.yaml): version **1.62.0**, SHA-256 `d337e37f63b186dc26288e09070e81c7209164ea6e8572deb67f747ec8824d51`. The dated HL-06 audit used 1.56.0; it remains a historical record rather than current execution proof.
- [Funding guide](https://docs.truemarkets.co/gateway/fund-a-wallet/): match the asset network to the customer's wallet; the balance's `available` amount is usable now. Network-fee sponsorship does not establish trading fees or settlement finality.
- [Asset guide](https://docs.truemarkets.co/gateway/what-you-can-trade/): listings have distinct IDs, chain, venue, product type, and asset class. The guide describes an unpaged catalog while the schema retains pagination; any returned non-null next cursor is rejected as incomplete evidence.
- [Circle native USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses): native Solana USDC is `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
- A credential-free public catalog GET found that mint's Solana/DeFi listing ID `ef4f2f65-e74a-4aa8-8581-4327c377c9bc`, six decimals, active status, and `tradeable: false`. See the dated [sanitized observation](evidence/hl-18-public-usdc.json). A settlement cash listing need not itself be directly buyable. This observation does not prove it is the candidate stock's quote asset or authorize a deposit.

The refreshed specification describes `available` after holds, and DeFi `available`/`total` as already net of allocation to CeFi. Subtracting `held` or `allocated` again would understate spendable funds. The adapter preserves those fields separately and feeds only `available` to the shared calculator. Missing `allocated` remains null rather than being invented as zero.

The availability endpoint describes the **request origin's country**. A backend call cannot by itself establish the end customer's location or eligibility. No country override/header workaround is invented here.

## Implementation boundaries

| File | Responsibility |
| --- | --- |
| `integrations/truemarkets/read-types.ts` | Bounded normalized types, fixed errors, native mint identity |
| `integrations/truemarkets/read-contracts.ts` | Strict identity, amount, availability and restriction validation |
| `integrations/truemarkets/reads.server.ts` | GET-only injected adapter; request-start timestamps; customer header only on private balance read |
| `integrations/truemarkets/solana-address.ts` | Shared decoded-32-byte Base58 validation, also reused by customer parsing |
| `features/market-data/repository.server.ts` | Read current account/profile mapping inside owner RLS; reject mismatched account/reference |
| `features/market-data/service.server.ts` | Match server eligibility evidence to owner/account/customer/route; enforce restrictions and freshness; shared allowance calculation |
| `features/market-data/handlers.server.ts` | Authenticated no-store API envelope; default live composition hard-disabled |

All modules are lazy/server-only where appropriate. No package or migration changes are required. The adapter accepts an injected Gateway-compatible transport and explicitly records `contract_fixture` or `provider` provenance. Tests never call an external provider. Runtime routes do not instantiate the live Gateway client.

## Single-route identity and schema rules

A route selects one exact stock listing ID/mint and one cash listing ID. The cash mint is pinned to native Solana USDC; ticker matching alone is insufficient. The stock must be active, tradeable DeFi spot stock on Solana and support market orders. Cash must be active, stable USDC on the same chain and venue with six decimals; its direct-trading flag is preserved but is not assumed true.

Listing UUIDs are canonicalized. Duplicate IDs, incomplete pagination, missing identities, a conflicting chain, wrong mint, wrong venue/type/class, unsupported precision, or malformed required fields block the route. Additional unrelated balance assets are not aggregated. A second copy of the selected listing with conflicting chain metadata is rejected rather than ignored.

Balances retain exact canonical decimal strings. Available, total and held are nonnegative, and the selected row must satisfy exact `available + held = total`. Allocation is not subtracted from either. Harmless storage padding is canonicalized before the six-decimal limit; nonzero excess precision, JavaScript numbers, exponent notation, NaN, signed/negative values, separators and whitespace are rejected. Zero is a valid observation, not a missing balance. No USD portfolio valuation substitutes for spendable native USDC.

Known restriction selectors are venue, product type, or asset class; exactly one selector applies per rule. Matching rules combine. Unknown selectors, invalid country data, partial pages or unknown availability lists fail closed. Country validation uses a shared pinned set of 249 assigned ISO 3166-1 alpha-2 codes from [IANA tzdb](https://data.iana.org/time-zones/tzdb/iso3166.tab), reviewed on the evidence date. Unassigned codes such as AA, XX and ZZ block availability, restrictions and customer/backend evidence. Updating that set is a reviewed data change. An unknown caller country blocks the read contract. The backend allowlists must explicitly include spot and stock, and the observed backend country must match the server-held guidance record. Restrictions apply to both the customer's verified country and the backend country.

## Access evidence is a trusted server dependency

The service first reads the owned account mapping. It requires a ready provider customer, enabled pilot, eligible profile and eligibility-check timestamp, and no active account operation. It does not grant these states or update eligibility columns.

A supplied server evidence record must match owner, account, provider customer, stock ID and exact quote-asset ID. It must affirm end-user approval, verified backend method, and quote-asset identity, cite nonempty guidance/method references, and carry canonical checked/expiry instants. It cannot predate the profile eligibility check or be expired/future-dated. Fixture evidence can be used only with a fixture adapter; provider mode requires provider-guidance provenance.

These records are **not cryptographic proofs**, and constructor injection is not authentication. Their authoritative issuer, persistence and verification are still prerequisites to live composition. They must never come from a request body, arbitrary client country, environment boolean, or a backend availability response alone. The default application supplies no such record and stays disabled.

## Freshness, ownership and result authority

The adapter timestamps the start of a read, before transport/retries. The service rejects negative ages and ages greater than 15,000 ms; exactly 15,000 ms remains in range. It rechecks metadata and balance age after network work and again after loading the owned plan, with evidence expiry checked at both boundaries. The calculation local date is resolved after the final plan lookup so crossing midnight cannot retain yesterday’s horizon. A slow response cannot appear newly observed merely because completion is recent.

All private requests use the server-resolved provider customer UUID. Public stock/cash/restriction/availability reads omit the customer header. The API accepts no caller identity selector. Every response is private/no-store and exposes fixed errors without SQL, upstream response bodies or credential details.

Results always have `canAuthorize: false`. They are information and calculation inputs, not investment or settlement authority. Eligibility or account state may change after a read; later review/approval must check current state under its own transaction protocol. This service does not release operation reservations or claim fill-to-balance consistency.

Funding previews require verified recovery/exit evidence and a valid owned Solana address. Even then they carry `depositEnabled: false`; the model itself never authorizes a deposit. Current runtime routes never reach that composition, and fixture results remain explicitly labeled.

## Planning integration and provenance

The service's allowance method obtains the plan through a server-owned planning dependency and passes normalized `available` into the existing exact calculator. It does not accept a client-supplied balance or commitment list. The result includes its original observation timestamp and policy revision and cannot authorize an order.

The read/calculation connection performs no snapshot writes. A disposable PostgreSQL integration test uses the actual owned-account reader and saved plan with the fixture adapter: 1,500 available minus a 1,200 commitment and 100 buffer produces 200, with existing balance/calculation row counts and currentness unchanged.

Snapshot persistence is deliberately deferred. The database still accepts fixture source only. A future provider-evidence migration must preserve original observation times, selected asset identity and customer association. Its revision check and balance/calculation writes must be atomic under the account lock: a rejected stale capture must not append a balance or invalidate an existing current calculation. Do not compose independent balance-recording and revision-checked capture operations into a command advertised as atomic.

## Verification and remaining work

Tests exercise route identity, ambiguity, restrictions, backend/country distinctions, malformed and padded money, stale/future/15-second-boundary evidence, scope/provenance/quote-evidence mismatch, private-header binding, exact allowance arithmetic, safe API errors, and disabled runtime composition. Disposable PostgreSQL tests verify actual account isolation, read-only calculation from a stored owned plan and preservation of existing snapshot records/status. Public catalog observation is evidence of metadata only.

Before full live HL-18 can be marked complete:

1. Obtain confirmed organization access and a ready owned customer through the separately verified provisioning path.
2. Establish the provider-approved end-user geography/onboarding method and supported pilot jurisdiction, with authoritative server-held evidence.
3. Confirm the exact stock/native-USDC quote relationship and intended deployment origin.
4. Verify signer recovery, supported exit and any funding instruction before an authorized deposit.
5. Add and review provider provenance persistence; preserve original observation time, selected asset identity and customer association.
6. Connect the verified live balance path to planning with visible source labels and current state checks. Test authenticated reads separately, without treating them as trading/settlement proof.

No provider message was sent. These requirements are a handoff, not permission for external communication, live provisioning or financial activity.
