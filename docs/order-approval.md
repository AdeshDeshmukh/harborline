# Explicit single approval — HL-23

## Authority and boundary

HL-23 implements the approval state machine against a **local fixture executor**.
It does not add an approval endpoint, UI action, signer, provider execute adapter,
environment activation switch, or completed trade. Existing review UI authority
flags remain false. Every approval receipt says `source: contract_fixture` and
`canExecute: false`.

`createApprovalRepository` defaults to disabled. A test harness must explicitly
set both `fixtureMode` and `fixtureApprovalEnabled` to true. Controls are checked
before opening the transaction and again after acquiring the account lock.
`createFixtureApprovalService` additionally rejects an omitted or provider source
before calling any dependency. Neither factory is composed into a runtime route.
These fixture controls do not establish pilot eligibility or enable production.

HL-18 customer/geography/location and HL-19 provider maximum-debit/expiry evidence
remain unresolved. This slice performs no provider calls, wallet signing,
funding, trading, live migrations or deployment.

## Approval command

The exact four-field command is:

```json
{
  "intentId": "00000000-0000-4000-8000-000000000001",
  "reviewRevision": 1,
  "termsHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "acknowledged": true
}
```

The UUID is normalized; revision must be a positive PostgreSQL integer and the
hash must be 64 lowercase hexadecimal characters. Missing acknowledgement,
unknown keys and caller-supplied ownership, cash, payloads or activation flags
are rejected. The future HTTP layer must derive `OwnerContext` from verified
authentication, as existing owned services do; this factory is not authentication.

Server-injected fixture balance evidence contains source, account, cash listing,
chain/venue, available amount and observation time. It is a dependency result,
never part of the approval body. It must match the owned review's selected cash
listing, Solana/DeFi route and exact cash value. Observation timestamps must be
canonical UTC, not future, and at most 15 seconds old at the final decision. A
refresh may equal the original observation timestamp but may not predate it or
promote an older observation to the latest stored sequence.

## Atomic decision

One short transaction takes the owned account update lock used by planning,
preparation and cleanup. Ownership includes the context's external reference.
For a new approval it verifies:

- The intent owns the active slot, is `REVIEW_READY`, has no possible effects,
  is a fixture buy sized in quote units, and has a ready account mapping.
- The requested immutable review revision/hash matches its stored terms,
  preparation generation, intent/account, calculation, policy, provider order,
  asset and quantity. Stored debit and expiry columns must match hashed bounds.
- The exclusive review deadline has not arrived. Approval at exactly the
  deadline is rejected; exactly 15-second-old balance evidence is allowed.
- Calculation, current policy, timezone and local date still agree. Its original
  fixture cash observation is owned, on the selected route, and still the latest
  stored observation before this approval.
- A separately refreshed server observation is fresh and has the same cash
  amount. Current stored commitments/buffer recompute the reviewed explanation,
  and maximum debit fits the resulting debit budget.

The cash-after-debit check uses **available cash minus maximum debit**. The
allowance budget separately protects commitments and buffer; deducting those
again from available cash would misstate the review. Available cash is not
reduced a second time for presumed provider holds.

After all prerequisite reads and locks, including the profile lock, the
repository samples a new decision time and rechecks controls, review expiry,
local date and balance freshness. A wait for a later lock cannot preserve an
earlier authorization window. This final time timestamps the approval, attempt,
state change and audit.

The transaction then inserts the new fixture balance observation, immutable
approval and unique execution-attempt claim, conditionally moves the exact
intent revision/generation to `SUBMITTING` with `effectsPossible: true`, and
appends a redacted audit event. All writes commit together. Missing update
results, domain conflicts or audit failures roll everything back.

The fixture refresh happens outside the transaction; age, ownership and controls
are checked again inside it. An observation may be newer than the calculation's
original observation, but its cash explanation must be identical. Any cash
change, including an increase, requires a new calculation/review rather than
silently approving different terms. This is intentionally conservative.

## Replay and fixture handoff

An exact repeat observes the original approval/attempt and current intent state
with `accepted: false`. It does not revalidate expiry to create new authority,
append evidence, acquire a replacement slot or invoke the fixture executor.
Changed review/hash conflicts with the original claim. The service checks for
replay before refreshing evidence, then the transaction checks again to settle
concurrent requests.

Only the transaction winner (`accepted: true`) invokes the injected fixture
executor, **after commit**, with a small receipt containing IDs, reviewed hash,
revision, approval timestamp and state. No payload, ciphertext, key, signature,
provider response or token crosses that boundary. A successful fixture callback
leaves `SUBMITTING`; it is not evidence of a fill or successful settlement.

A thrown callback records `UNKNOWN` under the same owned lock and retains the
slot, immutable attempt and possible-effects fence. Raw exception details are
not persisted or returned. If persisting uncertainty itself fails, the caller
gets a bounded unavailable error and the prior `SUBMITTING` claim remains held.
No callback is retried. A process crash after commit but before callback also
leaves the operation held. This design provides one local dispatch claim, not
an exactly-once provider effect guarantee.

If controls are disabled after a claim, new authority is blocked; failure to
record an internal fixture completion cannot free the financial slot. Future
reconciliation must use durable evidence, never lease age alone.

## Storage and migration

Additive migration `0006_order_approvals.sql` adds `order_approvals` and
`execution_attempts`; older migrations/snapshots remain unchanged. Both tables
have forced owner RLS and SELECT/INSERT-only application grants. Signer and
public roles have no access. Approval insertion requires the authenticated
owner ID in addition to owned-account visibility.

Foreign keys bind approval to the owned intent, immutable review revision and
owned balance observation. The attempt's composite approval/intent/account
foreign key prevents linking a claim across accounts. Unique intent and approval
attempt constraints prevent a second handoff claim. Source checks allow only
`contract_fixture`. Application roles cannot amend or delete either record.

The account slot serializes different intents as well as repeats. It stays held
through `SUBMITTING`/`UNKNOWN` regardless of age. Existing local `advance` helpers
remain state-model utilities, not approval or execution authority.

## Verification and next slice

Tests exercise 20-way repository and service competition, exact replay,
different intents on one account, changed terms/revision/binding, ownership,
cash freshness and lock delay, expiry, timezone/date/policy, current commitment
and buffer changes, unavailable account mapping, disabled controls, rollback
on audit/CAS failure, immutable grants/RLS and the post-commit fixture handoff.
Lost callback responses and the crash window retain the slot without redispatch.
Profile-lock tests observe the actual PostgreSQL wait, then change expiry, cash
age, local date or controls; an in-bounds case verifies the later approval time.
A refresh older than the reviewed observation is rejected. A callback disabling
controls before failing returns unavailable with its committed claim still held;
re-enabling controls cannot cause redispatch. The isolated attempt/account FK
test requires the named FK violation and was checked to fail when that constraint
was temporarily removed from the unpublished local migration, then restored.
Existing migration tests now expect six journal entries and twelve forced-RLS
tables, while retaining their saved-record checks.

Local verification after the review fixes: 450 passing tests (6 provider-script
tests without live calls, 288 unit/contract tests, 156 disposable PostgreSQL
tests), ESLint, TypeScript and production build on Node 24.22.3. The independent
review's findings were reproduced and fixed in one regression-test pass; the
reviewer did not perform a second review or live verification.

HL-24 owns the signer, exact stored-payload verification, actual execute adapter,
orchestration/HTTP endpoint and disabled-by-default UI connection. It must
recheck verified live controls and deadline immediately before signing/sending;
fixture acceptance here is insufficient. HL-25/26 own recovery and evidence-based
slot release. No real Supabase deployment, provider execution or end-user
approval browser flow has been verified by HL-23.
