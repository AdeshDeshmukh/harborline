# Local recovery workers and manual settlement — HL-26

## Status and authority

HL-26 adds a fixture-tested background recovery foundation and an evidence-backed
manual clearance transaction. This is not live settlement activation. Provider
fill-to-balance consistency, eligibility, deployed scheduling and production
operator authentication remain unverified gates. All new financial records are
`contract_fixture`; the worker, observer and clearance repository require explicit
fixture composition. No code path provides automatic verification.

The public [balance contract](https://docs.truemarkets.co/api/gateway/get-balances/)
describes user balances, while [order details](https://docs.truemarkets.co/api/gateway/get-order/)
describe fills and optional transaction hashes. The reviewed contracts do not
establish an order-linked balance version or a verified read-after-fill guarantee.
This is the limit of the reviewed evidence, not proof that no provider guarantee
could exist. The [transaction feed](https://docs.truemarkets.co/gateway/activity/)
can support investigation, but a matching status or two equal balances alone
cannot prove the reconciled cash baseline. No private provider route was called.

## Durable owner-scoped work

`work-repository.server.ts` seeds one `recovery_work` row for an approved fixture
financial intent still holding its account slot. It does not schedule unsigned
reviews or create execution attempts. The source, account and intent identity
are immutable to the application role.

A claim locks the owned account and the due job (`FOR UPDATE SKIP LOCKED`), writes
a random lease token and a 60-second deadline, increments its attempt count and
appends redacted audit. The claim commits before any network call. Another worker
can reclaim at exact lease expiry; the old token cannot finish or change the new
schedule. A suppressed lease update cannot return a nonexistent capability.

Completion checks token, owner and unexpired lease again. Retry deadlines are
5, 10, 30, then 60 seconds after completion, capped at 60 seconds; terminal work
awaiting verification uses 60 seconds. A released/replaced slot stops its old job.
Lease expiry never grants signing, preparation or execute authority.

The scheduler receives trusted server-created owner contexts, supplied by explicit
fixture composition, and uses the existing owner RLS database role for each.
There is no administrator connection, global owner scan, request-supplied target,
new bypass-RLS worker role or organization-wide provider feed. This fits the
controlled pilot foundation; wider discovery and authenticated configuration
remain release decisions.

The worker prepares configured owners concurrently with a five-second bound per
preparation, then sorts candidates by their durable attempt counts (least attempted
first, with a deterministic account tie-break). Fresh worker instances therefore
do not repeatedly select only the first ten accounts. A repeatedly hung network
read moves its account behind less-attempted work on the next invocation; a stuck
preparation cannot consume the whole batch. Configuration is bounded to 100 trusted
targets. This is durable scheduling fairness, not production throughput proof.

## Bounded invocation and cancellation

`createDueReconciler().runDue()` starts at most ten claimed jobs per invocation
and has a 30-second budget. It invokes HL-25's owned read service, then observes
cash only for an unconflicted terminal result. It never calls clearance, signing
or execution. Errors count toward a fixed aggregate response and preserve durable
work for a later attempt; the job is not mistaken for a new financial request.

The budget aborts a shared signal. The order and balance GET boundaries receive
that signal; a response arriving after abort cannot start observation persistence.
The caller can return even if an injected transport ignores cancellation. Already
running database work is not magically canceled: the existing 3-second lock and
5-second statement timeouts bound individual database operations. No account
transaction is held across a GET.

The backoff values are earliest eligible times, not a promise of five-second
production polling. No schedule configuration or deployment is included.
[Vercel cron documentation](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs)
describes duplicate/missed delivery and daily-only Hobby cron. A suitable scheduler
and cadence must be chosen and verified before activation; leases and idempotent
reads remain necessary regardless of the platform.

## Internal endpoint

`GET /api/internal/reconcile` verifies a server-only `CRON_SECRET` using a bounded,
header-safe value of 32–256 characters and constant-time comparison. It accepts
no query selectors or request body; HEAD does not run work. Responses are
private/no-store and project aggregate counts only, never account IDs, lease
tokens, provider responses, proof references or exception text.

Missing/invalid configuration returns bounded unavailable; incorrect authorization
returns 401. Even with a correct secret, the exported runtime handler returns 503:
there is no default worker/database/provider composition. Injected fixture handlers
exercise the contract in tests. Setting a secret does not activate private reads.

## Separate settlement balance observations

The planning and market-data balance services reject active account operations.
Those guards stay in place. `settlement-basis.server.ts` instead loads the owned,
slot-holding terminal intent, immutable approval/review, approved pre-trade cash
and the latest accepted terminal read under the account lock. It checks the exact
provider mapping, generation, order, asset, quantity, quote currency and source.

All actual filled, remaining and fee amounts must be known. The local terminal
must agree with the persisted provider status. The newest order-read ticket must
have that accepted terminal observation; an unfinished newest ticket blocks
clearance. A completed newer ticket can supersede a crashed older read. If an
execution dispatch exists, its callback must have a durable completion record.
A genuine orphaned dispatch without that record remains held for future explicit
abandoned-dispatch investigation; this command cannot force-clear it. Conflicting observations or an
existing manual-review state block this basis; there is no force-clear override.
An operator must investigate such cases before a future explicit resolution path.

Before requesting cash, `beginBalanceRead` commits an immutable
`settlement_balance_reads` ticket with an owned terminal basis, request-start time
and database sequence. The observer requests only the owned user's balances.
Only the newest balance-capture ticket can record a response or support clearance,
including when two starts have equal millisecond timestamps. Response arrival or
insert order cannot make an older capture authoritative. An unfinished newest
capture blocks clearance until a newer completed capture supersedes it.
Persistence rederives the basis and checks its read/revision/provider/cash binding,
full native Solana USDC identity, exact amount normalization and `available + held
= total`. Observations must be no more than 15 seconds old, not future-dated and
not earlier than the terminal observation. Chronology must also satisfy approved
balance time ≤ approval time ≤ order-read start ≤ terminal evidence ≤ balance
capture ≤ balance recording ≤ verification. Clock reversal cannot create a
pre-approval post-trade baseline. Missing or malformed evidence rejects.

These immutable `settlement_balances` rows link to their owned capture ticket
and retain insertion sequence for history; capture sequence governs authority. They do not become planning cash merely because
a terminal response was received.

## Manual proof and clearance

Only an explicitly enabled fixture repository with a configured operator UUID
in its trusted allowlist can run `clear`. This is an injected fixture authority
model, not production authentication. The operator does not come from an HTTP
body; no public manual-clearance endpoint exists.

The proof contains an intent ID, observation ID, idempotency request key, actual
wallet debit, intervening credits/debits and four bounded fixture references:
order, wallet, balance and intervening activity. The order and balance references
must bind to the selected stored order/observation. Extra flags such as `verified`
are rejected. References and operator attestation are not cryptographic evidence
or automatic provider proof.

Under the owned account lock, clearance requires:

1. An unconflicted terminal basis with actual fill/remaining/fee information.
2. The newest owned balance observation, still matching the read, revision,
   provider user and cash listing, and still within the inclusive 15-second bound.
3. Zero outstanding provider cash holds for this single-route pilot.
4. Actual debit within the approved maximum and consistent with actual fees/fills.
   A failed/canceled partial fill can have a real debit; status alone is insufficient.
   When actual VWAP is known, filled quantity × actual VWAP + fee must agree exactly
   with wallet debit under the fixture's added-fee, six-decimal cash model. An
   unresolved rounding difference or fee interpretation blocks; it is not rounded
   into agreement. Missing VWAP still permits independently attested bounded debit.
5. Exact `before available + intervening credits - actual debit - intervening debits
   = observed available`. No quote-derived debit or unexplained difference passes.
6. No other known effect-possible intent without a recorded settlement verification.
7. The account slot still points to this intent and operator controls still permit
   the fixture operation.

The transaction appends a new planning balance baseline, an immutable
`settlement_verifications` row linking the owned baseline and observation, clears
only that slot and appends redacted operator audit. An audit or suppressed-release
failure rolls everything back. A successful SQL statement that inserts zero audit
rows is also a failure: the transaction requires one returned audit identity. The old pre-trade cash cannot remain the current
planning balance. Future review/approval must still meet their own fresh balance
and current calculation requirements.

The same canonical request replays its historical verification without touching
a subsequent account operation. A changed proof under that key conflicts. The
owned recovery projection reports `settlementVerified: true` only from a stored
verification; `canExecute` remains false. Newest-read conflicts are never resolved
by changing a status word or waiting for a lease.

## Maintenance command and database rollout

`node scripts/record-manual-reconciliation.mjs --proof-file <file>` is deliberately
hard disabled by default and exits before reading a file or opening a database.
Its reusable runner accepts only explicitly injected fixture composition bound to
the configured repository/operator, opens only regular proof files (not symlinks
or FIFOs), reads at most 4097 bytes to enforce the 4096-byte limit before parsing,
and prints
only a verification identity. The integration test binds it to the real local
owned clearance transaction. A live authenticated operator command is not claimed.

Migration `0009_settlement_workers.sql` adds `recovery_work`,
`settlement_balance_reads`, `settlement_balances` and `settlement_verifications`, with forced owner RLS,
composite ownership foreign keys and bounded source/amount/time constraints.
The application can select/insert the new tables and update only the job's lease,
attempt, scheduling and stop fields. Evidence/verification rows cannot be updated
or deleted. Public and signer roles have no grants. Published migrations and
snapshots are unchanged. Apply the additive migration before any future service
composition; no production migration was performed here.

## Verification and remaining limits

One independent whole-slice review identified nine material issues: unfinished
execution callbacks, pending newest order reads, reversed balance captures,
contradictory fill/debit economics, reversed chronology, suppressed audit inserts,
worker starvation, supported long order references and unbounded/FIFO file input.
Each was reproduced before one correction pass. There was no second review;
regression tests and the complete suite establish post-fix verification.

After corrections, **627 tests passed**: six offline provider-script, 363
unit/contract and 258 disposable PostgreSQL tests. Coverage includes timestamp-tied
reversed balance delivery, pending-ticket supersession, real delayed execution,
partial-fill economics, 128-character order IDs, three phases of chronology,
missing/raised audits, a new operation during proof replay, least-attempted
scheduling across fresh workers, stuck preparation and a proof FIFO subprocess.
Nine migrations install nineteen forced-RLS tables; previous record-preservation
and inventory assertions remain in the full suite.

Lint, typecheck, the production build, post-build typecheck and migration metadata
validation passed on Node 24.22.3. The isolated test database was stopped after
verification. No commit, push, PR, deployment or live operation was performed
during this local implementation. These are local fixture/database/handler
checks, not live provider acceptance, deployment, real process-kill, production
role proof, a proven automatic settlement contract or broader multi-user readiness.
