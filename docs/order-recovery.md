# Read-only fixture order recovery — HL-25

## Purpose and authority

An approval can persist before its callback runs, and a send can succeed before
its response is saved. Neither situation permits another execute. HL-25 adds an
owned `reconcileOrder` service that reads the stored provider order and records
bounded status and actual fill evidence without creating another attempt,
dispatch, signature or mutation request.

The service, repository and GET adapter require explicit fixture composition.
The repository additionally requires `fixtureRecoveryEnabled` to begin a read.
There is no default transport, environment activation, HTTP endpoint, worker,
cron job or UI action in this slice. Provider mode is rejected. The existing
approval route remains disabled; no customer/provider account was accessed.
Recovery controls are separate from approval/execution controls: disabling new
trades must not prevent read-only recovery. Once a read is authorized, disabling
new recovery reads does not prevent recording its result or viewing stored data.

## Owned reads and durable history

Migration `0008_order_recovery.sql` adds two append-only tables:

- `order_recovery_reads` commits a ticket before the GET, including a database
  sequence, intent revision and exact provider/approval binding.
- `order_recovery_observations` records one normalized outcome per ticket,
  its hash, timestamp and `applied`, `ignored` or `conflict` disposition.

Both tables have forced owner RLS, composite ownership foreign keys and
SELECT/INSERT-only application grants. Public and signer roles cannot read or
write them. Existing migrations and snapshots remain unchanged; migration
inventory checks now expect eight migrations and fifteen forced-RLS tables.

The repository locks the owned account while validating the active operation,
possible-effects fence, fixture approval/attempt, immutable review hash and
preparation generation. It derives provider user/order IDs, stock ID, quote
asset and request quantity from stored evidence. No browser/provider IDs are
accepted as authority. It reads review terms, not encrypted signing payloads.
Configuration/input errors from the adapter propagate without fabricating a
provider observation; its committed ticket can remain without an observation.
Only actual transport attempts produce bounded unavailable/not-found results.

Current review expiry, cash freshness and plan changes are not prerequisites
for reading an already approved order; requiring them would strand recovery.

The service commits the ticket, releases the transaction and makes one injected
`GET /v1/gateway/orders/{storedId}` with the owned provider user scope. A second
transaction takes the same account lock and applies the observation only if it
is the newest ticket, the intent revision is unchanged, and the provider and
approval bindings still match. A late result remains ignored history. There is
no account lock or transaction across the network request.

Re-recording the same normalized facts for one ticket is idempotent, including
under concurrent calls. Different facts for the same ticket reject. Ticket/audit
and observation/state/audit writes each commit atomically; errors and suppressed
intent updates roll back that transaction. A recording failure leaves the
already committed ticket and financial slot available for later recovery.

## Cooperation with the original execution

An indeterminate GET cannot tell whether the original callback crashed or is
still signing/waiting for its POST. It therefore appends observation/audit only
while the local state is `SUBMITTING`. A same-state submission update is also
forbidden by the existing SQL fence, so no intent update is issued in that case.
This prevents polling from canceling a still-valid first send. A confirmed
pending/terminal GET can advance state and prevent an already-submitted send.

The uniquely claimed original dispatch may still return after such a read.
Its completion recorder now accepts that response beyond `SUBMITTING`, under
the same owned account lock and immutable approval/attempt binding. It records
an applied, ignored or conflicting redacted outcome; a terminal response can
complete a pending/unknown intent, but never regress a terminal or clear manual
review. Conflicting terminal replies produce a sticky manual flag, even when
the GET completed first. Identical outcome replay adds no duplicate state/audit.
Both writers use shared terminal history; neither gains new dispatch authority.

A hard-crashed submission with only indeterminate evidence can remain
`SUBMITTING` rather than be guessed `UNKNOWN`. HL-26 must decide worker/operator
handling using durable evidence. This is an availability cost, not a resend
permission or a settlement conclusion.

## Status, uncertainty and actual quantities

The [order guide](https://docs.truemarkets.co/gateway/place-orders/) directs
already-submitted execution toward a read. The
[order detail contract](https://docs.truemarkets.co/api/gateway/get-order/) is
used rather than an empty list as evidence: created, unexecuted orders need not
appear in the order list. These public contracts inform fixture validation;
they do not establish a live eligibility or settlement guarantee.

| Observed fact | Local treatment |
| --- | --- |
| `pending`, `active`, `cancel_pending` | `PENDING`, unless a terminal/manual state must be preserved |
| `complete`, `failed`, `canceled` | Corresponding terminal state, preserving terminal/manual fences |
| `initialized`, 404, timeout/unavailable | Preserve the current state, including an original `SUBMITTING` callback; slot stays held |
| Malformed or mismatched order | Review conflict; no provider facts accepted as actual evidence |
| Different terminal outcome or cumulative quantity regression | Sticky review conflict; prior applied evidence retained |
| Late ticket, changed revision or changed mapping | Ignored history; current intent and actual evidence preserved |

Terminal states never regress. Terminal facts in accepted GET history and the
original dispatch outcome also fence later results when local manual state hides
them. An existing `MANUAL_REVIEW` state cannot be
cleared by a provider status. A conflict flag remains true after later valid
reads. Manual clearance and settlement are later work, not implicit recovery
transitions.

The normalizer validates exact order/asset/route/side/type/quote-sized request
bindings. Seven provider statuses are supported; `partial` is not a provider
status. Partial evidence is derived only when both actual base filled and
remaining quantities are supplied and positive.

Actual `executed_qty`/`leaves_qty` use base units. They are never compared with
the quote-unit requested quantity. `executed_vwap` and cumulative quote fee are
stored separately from review estimates. Amounts are bounded nonnegative exact
decimal strings; harmless trailing zero padding is canonicalized before asset
precision validation. Genuine sub-unit precision is rejected. Optional/missing
values stay null rather than becoming zero.
A known zero fill or nonzero remaining quantity contradicts `complete`. A positive
fee with an explicit zero fill, or a positive fill/fee on `initialized`, also
contradicts the order contract and becomes a review conflict.

Each normalized snapshot is preserved exactly, including nulls. A later complete
snapshot missing its final fill does not inherit an earlier partial fill and
mislabel it as final. Historical applied fill/fee high-water marks and remaining
low-water marks detect regressions across snapshots with missing fields.
`current()` projects the latest applied observed snapshot plus separate metadata
for the latest recorded read; an unavailable or ignored read can be newer than
the actual evidence. A receipt must not treat the latter as a new fill timestamp.

The public view explicitly projects status, actual amounts, partial evidence,
latest read metadata and held/manual flags. Raw response fields, failure text,
keys, payloads and signing envelopes are not stored in observations or audit
metadata. The view always reports `canExecute: false` and
`settlementVerified: false`.

## Trade-offs and remaining limits

Local sequence ordering is conservative, not a provider event version. It can
ignore a useful older response if a newer read started first; another read may
be needed. The contract supplies no guaranteed provider update timestamp here.
History is retained without automatic pruning; scheduled work, rate limiting,
backoff and bounded polling belong to HL-26.

No status, elapsed time, 404, initialized result or repeated balance releases
the account slot. A terminal order can therefore block another operation until
settlement evidence or audited manual clearance is implemented in HL-26. HL-27
owns activity/status pages and receipts. No deployment, real process kill,
live provider execution/read, browser recovery, settlement or financial
correctness of a live integration has been demonstrated by fixture tests.

## Local verification

The tests exercise normalization/privacy, GET-only scoped transport, explicit
source controls, approval-before-dispatch recovery, persisted uncertainty read
by a fresh service instance, concurrent readers without a network-held lock,
replays, changed mapping/revision, partial/missing/contradictory facts, terminal
and manual fences, cross-owner access, forced RLS and append-only grants,
composite ownership constraints, audit rollback and suppressed-update rollback.

The pre-review suite passed 548 tests. One independent whole-slice review found
five issues: interference with the original in-flight dispatch, terminal history
under manual state, fabricated unavailable observations on configuration errors,
unfilled actual/fee contradictions, and rejection of harmless decimal padding.
All five were reproduced with failing tests and corrected in one fix pass.
A second review was not performed; the final suite/build results below establish
verification of the correction pass.
These counts describe local evidence, not deployed or live-provider verification.

After the correction pass, the complete suite passed **564 tests**: six offline
provider-script tests, 334 unit/contract tests and 224 disposable PostgreSQL
tests. ESLint, typecheck, production build and post-build typecheck passed on
Node 24.22.3; migration metadata validation passed. The final added scenarios
cover paused original signing, GET-before-POST completion, conflicting terminal
responses in both directions, and concurrent completion replay. The isolated
PostgreSQL cluster was stopped after verification. No commit, push, PR,
deployment or live operation was performed for this slice.
