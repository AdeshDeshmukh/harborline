# Quote and maximum-debit contracts — HL-19

## Status

This is a local contract foundation, not a live quote or order integration. No new endpoint, provider transport composition, signer, order creation, or approval path is added. Every normalized or assessed result has `canAuthorize: false`. Full HL-19's provider maximum-debit and expiry prerequisites remain unverified, and HL-18 live activation is still gated.

## Evidence reviewed

Reviewed 25 November 2026: the [official Gateway specification](https://docs.truemarkets.co/openapi/gateway.yaml), version **1.62.0**, SHA-256 `d337e37f63b186dc26288e09070e81c7209164ea6e8572deb67f747ec8824d51`, plus the [order guide](https://docs.truemarkets.co/gateway/place-orders/) and [FAQ](https://docs.truemarkets.co/gateway/faq/). No authenticated request was made.

The specification distinguishes:

| Contract | Meaning | What it does not prove |
| --- | --- | --- |
| `QuoteResponse`, POST `/quotes` | Nonbinding expected base quantity, execution price, notional and fee | Execution permission, maximum wallet debit, price lock or expiry |
| `QuoteDetails`, DeFi order information | Input amount, expected output after fees, fee denomination, issues and asset identifiers | Fee inclusion in input, enforceable maximum debit, explicit expiry or prepared-order validity |

The preview schema describes fees in quote units, added on a buy. Accordingly, its `estimatedDebit` is exact `notional + fee`; it is explicitly an estimate, not a maximum. Its notional may be smaller than requested after base-increment rounding.

The detailed DeFi schema describes a fee but does not establish whether its input quantity includes that fee. Its fields do not define a maximum-debit parameter or explicit expiry. The code does not add guessed fields or invent a slippage setting.

`QuoteRequest` does not contain a venue/chain override. No such parameters are manufactured. Selected asset context is not proof of the venue used in an eventual order. This slice sends no quote or create-order request.

## Interfaces

- `quote-types.ts` defines quote context, normalized nonbinding views, fixed errors, explicit fixture terms, and assessment outcomes.
- `normalizePricePreview(raw, context)` validates a complete `QuoteResponse` and returns a frozen `nonbinding_preview` with null maximum debit and null expiry.
- `normalizeDefiQuote(raw, context)` validates `QuoteDetails` and returns frozen `defi_quote_information`, including immutable issues and a deterministic fingerprint.
- `assessFixtureTerms(quote, evidence, debitBudget, now)` returns either a fixed blocked reason or explicitly labeled `bounded_fixture`; it never grants authority.

Context is a trusted server consumer's selected metadata and request, not an authorization object from the browser. It pins the exact stock ID/mint, native Solana USDC ID/mint, DeFi spot stock class, decimal scales, market-buy/quote sizing, requested input, observation time and provenance. Identifier aliases are restricted to selected listing IDs, addresses or the exact selected stock symbol/native USDC symbol. Arbitrary base or fee-currency aliases cannot redefine the route. A selected alias that can name both legs is rejected, even when another spelling was selected for the other leg.

Quote details do not independently echo full listing identity, chain or venue. Their identifiers are checked against the selected context, but a symbol match does not prove an executable route. Actual provider information remains unverified for authorization even if all quote fields parse.

## Validation and arithmetic

Both schema normalizers reject unknown or missing fields rather than interpreting new economic fields as harmless. Required amounts are decimal strings, not JavaScript numbers. Nonnegative fees may be zero; inputs and expected outputs must be positive. Native USDC values are limited to six meaningful decimals; stock output follows the selected listing's supported precision. Canonical zero padding is accepted without accepting nonzero excess precision. Amount overflow blocks the result.

Only buys sized in quote units are supported. DeFi input must match the requested amount. Preview notional cannot exceed it. Unsupported listing/mint/chain/venue/class, mismatched base/quote identifiers, or fees denominated in another asset fail closed. Fee identifiers must use exactly the selected quote identifier spelling; mixing a USDC symbol with a selected USDC mint/ID is conservatively rejected until a verified alias mapping is implemented. No float arithmetic or display rounding is used to authorize a cap.

Any quote issue blocks fixture assessment; an empty issues list is required for the bounded fixture path. Errors use fixed codes and messages without echoing provider values.

## Fixture-only maximum-debit and expiry rules

A fixture evidence record must include exactly:

- Source `contract_fixture` and a nonempty fixture contract reference.
- This normalized quote's fingerprint.
- Explicit maximum debit in native USDC.
- Canonical expiry instant.
- Explicit fee treatment: `added_to_input` or `included_in_input`.

For added fees, the supplied cap must cover input plus fee. For included fees, it must cover input and the fee must be strictly less than the input so positive output has nonzero swap input. The cap may not exceed the exact remaining debit budget. These are checks of **explicit fixture assumptions**, not assertions that the provider enforces them.

The fixture validity deadline is the earlier of the supplied expiry and observation time plus 20 seconds. The interval is start-inclusive and deadline-exclusive: at the deadline the assessment is stale. Future observations, invalid clocks, expired terms, and missing evidence block assessment. This local freshness deadline is not a provider promise.

A real provider quote is always blocked with `unverified_provider_contract`, even if a caller supplies a fixture cap or expiry. Missing fixture terms produce `unverified_terms`. Successful fixture assessment remains `canAuthorize: false`; source labels cannot be used to bypass the live integration gates.

## Fingerprint and immutability

The SHA-256 fingerprint covers selected listing identity, source, observation time, identifier bindings, requested/input/output quantities, fee denomination and amount, precision and issues. Canonical amounts produce consistent fingerprints; changing economic or route terms changes the fingerprint. Caller mutations cannot rewrite normalized objects or their issue arrays.

This fingerprint is an integrity correlation value, not a signature, credential, provider guarantee, ownership proof or user approval hash. Anyone can hash public quote terms. Later modules must bind account/owner, operation/review identity, payload digest, policy/calculation revision and explicit user approval separately.

## Handoff and remaining gates

HL-21 must check the actual create-order envelope: owned customer mapping, selected route, returned venue, initialized state, nonempty order ID and exact unsigned payloads. An issue-bearing or empty-ID response is not an executable order. A quote normalizer is not a reason to create a live order as a probe.

Before provider terms can enter a real review, obtain and test a provider-enforced cap, fee inclusion/denomination, applicable expiry and exact route association. Preserve original observation times. A changed quote needs a new review and explicit approval; do not silently reprice or reuse earlier approval.

HL-23 must recheck current policy, balance, eligibility, operation slot, deadline and reviewed terms under its transaction protocol. Fixture assessment is never an execution precondition by itself. No existing live gate or database schema is relaxed here.

## Validation scope

Unit fixtures cover known-good preview/debit examples; required fees and schema drift; exact decimal precision; wrong routes/identifiers/fee assets; zero fees versus zero trades; immutable results and fingerprint changes; unknown/provider bounds; added versus included fees; caps above allowance; expired/future/malformed evidence; and exact local deadline boundaries.

The full project suite, build, lint and typecheck remain required. There is no new browser flow, deployed endpoint, database migration, provider quote/order call, funding action or trade in this slice.
