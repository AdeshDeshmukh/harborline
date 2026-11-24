# Exact planning values — HL-13

This slice defines the shared pure money/date primitives for later allowance
calculation and persistence. It does not calculate an investment allowance,
read balances, create commitments, expose a planning API, or change the UI.

## Monetary contract

Amounts cross JSON and persistence boundaries as decimal strings. Never convert
an authoritative amount to JavaScript `Number`, use `parseFloat`, or round a user
input into a supported quantity. `DecimalAmount` is a canonical nonnegative
numeric string, not proof of currency, asset identity, ownership, balance
freshness or spending permission. Those belong to the owning integration and
authorization layers.

The storage bound follows the plan's PostgreSQL `NUMERIC(38,18)`: at most 20
integer digits and 18 fractional digits. The maximum is
`99999999999999999999.999999999999999999`. Negative values are not accepted.

`parseAmount` accepts an unsigned fixed-point string with a required integer
part. Only `0` may have a leading zero. It rejects exponent notation, whitespace,
grouping separators, decimal commas, signs, partial decimals, Unicode digits,
hex/binary values, non-finite values and every non-string input. Inputs longer
than 64 characters are rejected before parsing. This is an explicit input policy;
the UI must guide users rather than silently reinterpret locale formatting.

Precision is checked on the entered fraction **before** trailing zeros are
removed. Thus `1.00` is valid at scale 2 and canonicalizes to `1`, while `1.000`
is rejected at scale 2. No input is silently rounded.

| Boundary helper | Accepted values |
| --- | --- |
| `parseAmount(value)` | Nonnegative storage-bounded value, at most 18 fractional places |
| `validateCommitmentAmount(value)` | Greater than zero, at most 2 entered fractional places |
| `validateBufferAmount(value)` | Zero or positive, at most 2 entered fractional places |
| `validateAssetQuantity(value, listingScale)` | Greater than zero, with explicitly supplied integer listing scale 0–18 |

Missing/unsupported listing precision is an error. Six decimals are not assumed
for USDC; a later adapter must verify the selected listing and supply its scale.
Higher-scale assets remain unsupported until the storage policy changes.

Entry precision is different from a database's fixed-scale representation. A later
repository should read a PostgreSQL value such as `1.000000000000000000` through
the storage-level `parseAmount`, not the two-place user-entry validator. Preserve
the stricter two-place validation when accepting a commitment/buffer edit.

## Arithmetic and display

`decimal.js` 10.6.0 is pinned. A private `Decimal.clone` uses 80 significant
digits, enough for exact bounded addition/subtraction. It is independent of the
library's global configuration. Instances do not cross the shared API: operations
consume validated strings and return validated strings.

- `addAmounts` sums an array exactly; an empty array returns `0`. Each intermediate
  result must stay within the storage bound. A scalar string is not an amount list.
- `subtractAmounts` returns an exact nonnegative difference. Negative results are
  explicit errors; later allowance logic must apply its own documented zero floor.
- `compareAmounts` returns `-1`, `0` or `1` using numeric rather than lexical order.
- `formatAmountDown` returns a fixed-width display string, defaulting to two
  decimals, always rounded down. It never changes the authoritative input.

For example, adding `0.10` and `0.20` produces canonical `0.3`, displayed as
`0.30`. Exact `9.999` displays as `9.99`; `0.009` displays as `0.00` while its
original exact value remains available for validation. Never substitute display
text for the saved exact quote, debit or allowance when authorizing an operation.

Arithmetic revalidates runtime values even if a TypeScript brand is bypassed.
Overflow and negative subtraction raise fixed `PlanningValidationError` codes;
errors do not include the supplied amount. Multiplication, division, FX conversion
and fee/slippage assumptions are deliberately outside this primitive API.

## Calendar contract

Commitments use local calendar dates, not UTC-midnight timestamps.
`validateCalendarDate` accepts real Gregorian dates in exact `YYYY-MM-DD` format,
from `0001-01-01` through `9999-12-31`. Leap-year rules reject invalid dates rather
than relying on JavaScript's date rollover. Timestamp strings, Date objects,
unpadded fields, whitespace and year zero are rejected.

`validateTimezone` accepts `UTC` or a supported IANA region/alias name containing
a slash, with a maximum of 64 characters. It verifies support through the runtime's
Intl database and preserves the selected spelling. Bare abbreviations such as
`EST`, bare `GMT`, numeric offsets and whitespace are rejected. Valid named zones
such as `Etc/GMT+5` are supported. ICU/timezone data can differ across runtimes;
the declared Node 24 environment is the verified target.

`localDateAt(instant, timezone)` requires a valid explicitly supplied Date and
timezone, and formats Gregorian year/month/day with Latin digits. It does not
read the current clock or default server timezone. Dates outside the supported
calendar range, including BC dates, fail explicitly. A boundary instant can be
different calendar days for different users; daylight-saving changes must not
be treated as fixed 24-hour date arithmetic.

`validateHorizonDays` accepts only numeric integers from 1 through 90. It performs
no implicit conversion of form strings and chooses no hidden default. Later UI
and policy code must explicitly apply/confirm the plan's proposed 30-day default.
Horizon date addition and inclusion rules belong to HL-14.

## Trade-offs and validation

Strict input formatting gives every caller the same unambiguous contract, at the
cost of rejecting familiar locale/grouping input. Canonical strings remove
unnecessary zeros, so display formatting is a separate operation. Storage-bound
aggregates fail on overflow rather than silently clipping. Type brands help
prevent accidental mixing but do not replace runtime validation or server-side
authorization. Pure modules can later be used for client-side feedback, while
the server must repeat authoritative checks.

Tests cover exact arithmetic at the storage boundary, exponent/non-string input
rejection, precision and positivity, overflow, global Decimal isolation, display
rounding, leap dates, local-midnight/date-line differences, DST transitions,
timezone validation and horizon limits. No database schema migration, provider
request or live financial experiment is introduced by this slice.

Local Node 24 verification passed 113 tests (6 provider-checker, 79 unit/contract,
28 disposable PostgreSQL), lint, type checking, a credentials-free demo production
build and frozen-lockfile installation. Independent read-only review found no
actionable blockers and separately ran the 20 focused planning tests. These
results establish the pure contract; future database writes, allowance logic,
browser flows and investment authorization need their own integration tests.

Reference: [decimal.js API](https://mikemcl.github.io/decimal.js/), reviewed
2026-11-24; signatures verified against installed 10.6.0 declarations. The installed
Next.js server/client guide was checked before creating these shared pure modules.
