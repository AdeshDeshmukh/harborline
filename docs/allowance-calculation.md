# Investment allowance calculation — HL-14

`calculateAllowance` is a pure, deterministic function implementing section 5 of
the product plan. It accepts an explicitly supplied available balance, planning
commitments, additional buffer, local as-of date, horizon and policy revision.
It does not read the clock, provider, database, environment or browser state.

## Calculation

Let `B` be available USDC planning units, `C` the sum of included commitments and
`R` the additional buffer. Return:

- `debitBudget = max(0, B − C − R)`.
- `shortfall = max(0, C + R − B)`.
- `commitmentsTotal`, canonical `additionalBuffer`, included commitment IDs and
  `formulaVersion: 1`.

The exact budget includes all costs; it is not the quantity to send to the
provider. A hypothetical requested buy of `100` plus an independently verified
extra debit of `0.20` needs a budget of at least `100.20`. This is an arithmetic
example, not a claimed provider fee model. An allowance result alone cannot approve
an investment.

The function uses the existing HL-13 decimal-string operations throughout.
Negative intermediate results are avoided by comparing available cash with total
planned needs, then subtracting in the appropriate direction. Exact tiny values
remain intact: a budget of `0.000000000000000001` may display as `0.00`, but the
calculation does not replace it with its display representation.

## Commitment inclusion and calendar horizon

`horizonEndDate(asOfLocalDate, horizonDays)` advances the already-resolved local
calendar date by an explicit 1–90 days. It uses UTC calendar fields solely to
perform calendar arithmetic, avoiding server timezone, daylight-saving elapsed
time, and JavaScript's special Date.UTC handling of years 0–99. A result outside
the supported Gregorian years 0001–9999 is rejected.

Include every `outstanding` commitment whose due date is on or before that end
date, including all overdue unpaid commitments. There is no lower date cutoff.
Exclude `paid`, `removed`, and later commitments. Date comparison is lexical only
after both dates have passed exact fixed-width Gregorian validation.

For `2026-11-24` with a 30-day horizon, a commitment due `2026-12-24` is included;
one due `2026-12-25` is excluded. The function chooses neither today's date nor a
hidden default horizon. A later server caller must resolve the user's local date
with the verified profile timezone and explicitly apply/confirm the default policy.

## Input validation

`AllowanceInput` follows the plan's section 10 contract. Every value is revalidated
at runtime; TypeScript types alone are not an input boundary.

- Available balance must be a nonnegative storage-bounded decimal string.
- Stored commitment/buffer values are canonicalized through the 18-place storage
  parser, then checked against the two-place planning policy. Thus fixed-scale
  database padding is accepted, while a genuine commitment of `1.001` is rejected.
  Commitments must be positive; the buffer may be zero.
- Every commitment needs a nonempty unique string ID, a valid due date and an exact
  `outstanding`, `paid`, or `removed` status. Even excluded records are validated;
  malformed records do not silently disappear from an otherwise plausible budget.
- Policy revision must be a positive 32-bit integer, matching the existing
  PostgreSQL account policy column. The revision is validated, not checked against
  a database or copied into the section 10 result. A later snapshot must retain
  its input policy revision and enforce invalidation independently.
- Commitment totals and combined needs must remain representable under the
  `NUMERIC(38,18)` bound. Overflow fails explicitly, even if subtracting a very
  large balance afterward could produce a representable result.

The input is not mutated. The result and its included-ID array are frozen, and
IDs retain input order. This protects an in-memory result against accidental
mutation; durable snapshots and approval records remain separate later work.

## Plan examples

| Available | Included commitments | Extra buffer | Debit budget | Shortfall |
| --- | --- | --- | --- | --- |
| `2000` | `1200` | `500` | `300` | `0` |
| `1700` | `1200` | `500` | `0` | `0` |
| `1500` | `1200` | `500` | `0` | `200` |
| `2000` | `1450` | `500` | `50` | `0` |
| `900` available from `1000` total with `100` already held | `500` | `200` | `200` | `0` |

Only `available` enters the calculation. Total balances, held amounts, expected
income, stock valuations or other extra properties are not additional inputs and
do not modify it. A later adapter must select the correct verified listing/chain
and supply that listing's available balance; this function cannot validate asset
identity or prevent a caller from supplying the wrong source value.

## Trade-offs and remaining boundaries

Validating every record makes failures visible at the cost of calculation
availability when one stored record is malformed. Bounded aggregates preserve the
storage contract at the cost of rejecting extreme combined needs. Explicit local
dates make testing reproducible and timezone behavior clear, at the cost of caller
responsibility for timezone and horizon selection.

This is informational planning, not segregated funds, financial suitability or a
spending guarantee. Freshness checks, quote fee/maximum-debit evidence, ownership,
eligibility, changed-policy invalidation, uncertain-operation blocking and explicit
approval belong to later server boundaries. A stale balance or unresolved execution
must never become tradable merely because this pure function returns a positive
number. Commitments/policy persistence begins in HL-15, immutable snapshots in
HL-16, and the explanation UI in HL-17.

## Verification

Tests use literal expected values from the plan and explicit fixture dates. They
cover all arithmetic examples, added commitments, exact/all-in debit comparison,
available-versus-held handling, overdue/today/horizon boundaries, paid/removed
exclusion, empty plans, tiny exact differences, fixed-scale storage values, leap
days/year changes, local-date differences, DST boundaries, invalid data, overflow,
determinism and immutability. No provider requests, schema changes, financial
operations or new user-facing routes are introduced.

Local Node 24 verification passed 135 tests (6 provider-checker, 101 unit/contract,
28 disposable PostgreSQL), lint, type checking and the credentials-free demo
production build. Independent read-only review found no blockers and separately
ran all 22 allowance tests. Optional additional valid upper-year boundary coverage
was deferred; the suite already verifies the lower-year boundary and upper-range
overflow rejection. These checks do not establish deployed balances, persistence,
approval readiness or a live financial integration.
