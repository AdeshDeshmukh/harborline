# Sell-back fixture contracts — HL-28A

## Status and trust boundary

This is the first of two focused local HL-28 slices. It introduces pure sale rules
and the [operations guide](operations.md). It does not implement a persisted sale,
operator authentication, an approval screen/API, execution, provider reads, stock
snapshots in the database, sale receipt or transfer. Full HL-28 acceptance and real
exit/recovery evidence remain pending.

The helpers take normalized fixture data, not raw Gateway responses. Their
`contract_fixture` labels and matching UUIDs do not authenticate a caller or prove
provider truth. HL-28B must construct expected bindings from verified server-owned
identity, supported catalog metadata and authorized observations. Never deserialize
an expected binding, trusted quote or manual movement attestation directly from a
browser request. Review/quote objects contain internal account/customer IDs and
payload digests: they are not public DTOs and need explicit safe projection later.

## Interfaces

| Module | Responsibility |
| --- | --- |
| `disposal-types.ts` | Fixed errors and explicit internal normalized fixture types |
| `disposal-validation.ts` | Strict field sets, canonical IDs/amounts/times, ownership/route and balance validation |
| `disposal-review.ts` | Build fixture review, revalidate current holdings/terms, compare canonical economic terms |
| `disposal-settlement.ts` | Independently reconcile actual stock debit and fee-net quote credit |

`buildDisposalReview(binding, request, holding, quote, now)` returns an immutable
fixture review. `revalidateDisposalReview(review, currentBinding, freshHolding,
now)` rechecks time and unchanged holdings/binding for a later boundary.
`assertSameDisposalTerms(expected, presented)` compares complete validated,
canonical internal reviews; the expected review must come from trusted server
storage in future integration. It is not a signature, database approval or a
replacement for atomic approval/send fences.

`reconcileDisposalFixture(review, actualObservation, proof, now)` returns
`kind: reconciled_fixture`, never a persisted cash verification. Review capability
fields stay `canApprove:false`/`canExecute:false`; reconciliation stays
`canRelease:false`/`canExecute:false`. No helper mutates state, calls a provider,
reads credentials or releases the shared operation slot.

## Review rules

- Bind owner, account, provider customer, intent, generation, policy revision,
  stock listing/address, quote listing and stock precision. Require native Solana
  USDC quote identity. Actual support/stock classification/eligibility must be
  established by the future caller; matching fixture IDs alone is insufficient.
- A request contains exactly `assetId` and positive `baseQuantity`. Precision is
  the selected stock's 0–18 decimals. Concrete token amounts and balances must
  fit at most 2^64−1 atomic units; use exact integer conversion. This fixture
  route conservatively models single-account SPL quantities, not unverified
  multi-account aggregates. Prices are ratios, and cumulative unrelated movement
  totals are separate; neither receives a single-transfer atomic cap. Compare
  with available base units; never
  subtract held units twice or require a positive cash buying allowance.
- Validate `available + held = total` exactly. Available capacity is distinct from
  total asset ownership used in settlement accounting.
- Quotes are explicitly sell/base, fixture-only and bounded to the exact request.
  Maximum base debit equals the requested base quantity. Fee asset must be the
  quote asset; fee treatment is deducted from proceeds. Base-denominated fees or
  fees charged separately to existing cash are unsupported.
- Keep expected gross proceeds, quoted fee, maximum fee and minimum net proceeds
  explicit. Derive expected net as gross minus fee; no money uses JavaScript
  floating-point arithmetic. The minimum is an illustrative fixture contract,
  not a provider-supported slippage guarantee.
- Holding/quote observations must be canonical UTC timestamps, not future and at
  most 15 seconds old at review creation. The fixture quote expires at most 20
  seconds after observation. Later revalidation requires an unexpired review and
  fresh holdings with unchanged available/held/total values and no regressed
  observation timestamp. The later holding observation must also be at or after
  review creation; a still-young pre-review observation is insufficient. This
  timestamp check alone does not prove a read began after an approval lock or
  dispatch claim: HL-28B must persist and fence those read tickets at the actual
  approval/send boundaries. These local limits do not establish provider finality.
- Payload references are 1–8 SHA-256 digests, not payload text. Strict field sets
  reject private extensions and selectors. Serialized reviews are rebuilt and
  derived values validated before term comparisons. Source data is copied and
  nested review collections frozen.

## Actual accounting

Required actual filled/unfilled base units, gross proceeds and fee must be known.
Null remains unverified, never zero or a quote estimate. An independent recorded
gross can accompany an unknown VWAP; a known VWAP must agree exactly with actual
filled quantity and gross at supported precision. No guessed rounding convention
is applied: non-integral quote atomic units remain blocked.

Fixtures require actual filled + remaining = the base-sized request. Complete
requires full fill and zero remaining; failed/canceled may contain a partial or
zero fill. Zero fill requires recorded zero gross/fee. Positive fill requires
positive gross, fee within the original ceiling and no negative net proceeds.
A full fill must meet the fixture minimum net regardless of its status label;
a partial failure/cancellation can have lower proceeds than the full-sale floor.
These normalized fixture semantics, particularly provider remaining-quantity and
fee/VWAP conventions, need independent provider verification before an adapter
uses them for real settlement.

Both assets must independently conserve units:

```
stock total after = stock total before + other stock credits
                    - actual filled stock - other stock debits
cash after        = cash before + actual gross proceeds - actual fee
                    + other cash credits - other cash debits
```

Use total stock ownership, so releasing a hold is not mistaken for an asset credit.
Post-stock and pre/post-cash holds must be zero for a candidate reconciliation.
All unrelated movements are explicit evidence inputs, not authenticated facts;
HL-28B must tie them to reviewed immutable observations/proof and reject unknown
or unexplained movements before any release. Post balances must follow the actual
report and be fresh at reconciliation; pre-cash must be fresh at review creation.
Order outcome may arrive after quote expiry: historical reconciliation must not
misinterpret expiry as permission to create or execute a new order.

Hand-checked fictional examples:

- Sell 0.50 of 1.00 units at actual 200 USDC/unit, fee 0.50: stock after 0.50;
  gross 100.00; net credit 99.50; cash 2,000.00 → 2,099.50.
- Failed partial sale fills 0.20, leaves 0.30, gross 40.00, fee 0.20: stock after
  0.80; net credit 39.80; cash 2,000.00 → 2,039.80.

## Integration still required

HL-28B must preserve existing buy v1 hashes/AAD and schema meaning while adding
versioned sale economics, owned stock observations, customer/operator boundaries,
shared account serialization/approval/dispatch, recovery and durable dual-asset
settlement/receipt projection. Do not reinterpret the existing six-decimal cash
`maximum_debit` as stock units or insert a dummy calculation for a sale.

There are no dependency, schema, migration, runtime route or environment changes
in this slice. Existing buy paths are unchanged. Tests cover these local rules;
they do not establish cloud authentication, live quotes, funded recovery or a
working return procedure. See the operations guide for the still-required gates.

## Known minor normalization limit

A zero-fill failed/canceled fixture with recorded zero gross/fee can currently
carry a non-null reported average price. That value cannot change the zero cash
or stock effects and is not included in the reconciliation result. Rejecting or
canonicalizing this meaningless price is deferred to the normalized-observation
integration; do not expose it as an execution price in a future receipt.

Atomic representation source inspected 26 November 2026:
[SPL token account amount is u64](https://docs.rs/spl-token-interface/latest/src/spl_token_interface/state.rs.html).
This is a token-program representation limit, not evidence about Gateway's wallet
aggregation, fee rounding or minimum proceeds guarantees.

## Local verification

After the independent review and one regression-tested fix pass, all 781 tests
passed: 6 offline provider-script, 504 unit/contract and 271 isolated PostgreSQL.
The new sale-contract coverage comprises 115 tests. Lint, typecheck, production
build, post-build typecheck and tracked/new-file whitespace checks passed.
Existing buy behavior, dependencies and schema/migrations are unchanged. No
browser check was needed because this slice adds no UI. No authenticated cloud,
provider, funded sale or return experiment was performed. The minor zero-fill
price normalization limit above remains deferred; it grants no release/execution
capability and is not an execution-price field in the result.
