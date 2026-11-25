# Immutable calculation snapshots (HL-16)

## Purpose and scope

A calculation is a historical explanation of an allowance, based on one owned balance observation and one planning revision. Editing a commitment or policy must not rewrite the explanation someone previously saw. A snapshot's continued presence does not mean its allowance remains current or authorizes an investment.

HL-16 adds server-only storage and its invalidation contract. It introduces no route, UI, provider request, trade, signature, funding action, or deployed migration. HL-17 builds the explanation interface; HL-18 supplies verified provider balance integration. All observations currently accepted by this store are explicitly **fixture** evidence, and all status responses have `canAuthorize: false`.

## Code and interfaces

- `src/features/planning/snapshot-types.ts`: public server-consumer types and fixed storage errors.
- `src/features/planning/snapshots.server.ts`: owner-scoped transactions, fixture observations, capture, historical retrieval, and currentness checks.
- `src/server/db/schema.ts`: Drizzle snapshot table definitions.
- `drizzle/0003_calculation_snapshots.sql`: additive migration and reviewed grants. Existing migrations and generated snapshots are preserved.
- `tests/db/calculation-snapshots.test.ts`: real PostgreSQL integration coverage.

`createCalculationStore(database?, clock?)` is lazy by default, following the existing database boundary. The injected clock is a trusted server dependency, never browser input.

| Method | Input | Result |
| --- | --- | --- |
| `recordFixtureBalance` | Verified `OwnerContext`; exact `{available, listingId, chain, venue}` | Immutable observation explicitly marked `fixture` |
| `capture` | Verified `OwnerContext`; exact `{expectedRevision, balanceSnapshotId}` | Persisted calculation using the database policy and commitments |
| `get` | Verified `OwnerContext`; calculation UUID | Original historical calculation, even after expiration or plan changes |
| `status` | Verified `OwnerContext`; calculation UUID | Currentness and a fixed reason; never financial authority |

Every consumer must supply a server-verified owner context. Scalar request values are copied before any asynchronous database work, so a caller reusing a mutable object cannot change the submitted evidence identity or revision. No account, owner, balance amount, timezone, commitment, or calculation result is accepted from a browser for capture. Runtime input validation supplements TypeScript at these boundaries. Fixture recording accepts strict nonnegative decimal strings and bounded nonempty identity fields; it rejects attempts to supply a provider source.

## Stored evidence

`balance_snapshots` stores a UUID, owned account, server-generated monotonic sequence, source, listing/chain/venue identifiers, available amount, and observation time. Source is constrained to `fixture` in both application code and the database. Available represents the already-spendable amount; the calculator does not subtract held funds again. This is a fixture convention, not a claim about verified provider balance semantics. Total/held fields, response provenance, and consistency guarantees require the HL-18 contract.

The sequence orders observations under an account lock. It is independent of timestamps and avoids ties when two observations use the same clock instant. It is not a provider balance version, a settlement proof, or a count exposed to the client. The current single-balance planning basis is conservative: any newly stored account observation supersedes the earlier one. Before supporting multiple assets, HL-18 must select a verified spending listing/chain/venue and scope supersession to that basis.

`calculation_snapshots` stores:

- Owned account, balance observation UUID, planning revision, formula version 1.
- All original calculation inputs: canonical available and buffer amounts, local date, timezone, horizon, policy revision, and all commitments with ID, label, amount, due date, status, and row revision. Excluded commitments remain present so the explanation can be reconstructed.
- Original result: commitments total, buffer, debit budget, shortfall, and included commitment IDs.
- Horizon end and creation instant.

Monetary values remain exact decimal strings, including inside JSON. The existing HL-14 calculator produces the result; there is no second allowance formula. Evidence returned from the store is recursively frozen. Reads use the persisted input/result rather than recomputing history against current policies. Historical retrieval checks ownership without validating the current profile timezone; even a malformed current timezone cannot hide an otherwise valid historical explanation. Capture and status still fail closed when the current timezone is invalid.

## Transactions and concurrent edits

Capture locks the owned account for update, then locks its profile for share. It reads the policy, commitments, timezone, and balance within that transaction, checks the expected revision, and inserts the complete calculation. A three-second lock timeout and five-second statement timeout bound database work. No network calls occur inside these transactions.

HL-15 plan mutations already take the same account update lock and advance the global planning revision. Therefore:

1. If an edit commits first, a capture using its old revision fails with `conflict`.
2. If capture commits first, its record remains intact; the edit advances the revision and makes that record outdated.
3. Two plan edits consuming the same revision still cannot both win.

Creating a calculation is an observation, not a plan edit, so capture does **not** advance the policy revision. Multiple calculations at the same revision are allowed; this operation neither reserves money nor consumes an approval. The profile lock stabilizes the local-date basis against a concurrent timezone update during capture/check.

New fixture observations and captures are blocked while an account operation is active. Historical reads remain available. Status reports the active operation as a reason to block use.

The clock is read after acquiring the account/profile locks. Waiting for a lock does not allow an already-aged timestamp to sneak past the freshness check. Observation ordering uses the database sequence, even if the test clock repeats or moves backward.

## Currentness contract

`status` reads account/profile state and the calculation in one owner-scoped transaction. Reasons are evaluated in this order:

| Reason | Meaning | `current` | `canAuthorize` |
| --- | --- | --- | --- |
| `policy_changed` | Account planning revision differs from the original revision | false | false |
| `timezone_changed` | Current timezone differs from the stored timezone | false | false |
| `date_changed` | Current local calendar date differs from the calculation date | false | false |
| `operation_in_progress` | Account has an active operation | false | false |
| `balance_changed` | A newer account balance observation superseded this one | false | false |
| `balance_expired` | Balance age exceeds 15 seconds, is negative, or is invalid | false | false |
| `fixture_only` | Fixture basis is otherwise current | true | false |

Exactly 15,000 ms is within the freshness window; 15,001 ms is expired. Even a fresh observation from a future instant is rejected. Local midnight changes the calculation basis independently of balance age.

A status response is a point-in-time read, **not a reusable approval token**. State can change immediately after its transaction ends. `current: true` only describes the fixture explanation. It must never be interpreted as eligibility, suitability, settlement, spend authorization, or a guarantee that a provider balance has no lag.

Capture rejects uninitialized policies, stale expected revisions, another owner's evidence, superseded or expired balances, and active operations. It never silently refreshes a balance or switches to another observation. The caller must explicitly obtain a new basis and recalculate.

## Security, immutability, and errors

Both tables use forced owner row-level security, with explicit revocation of prior/public/signer privileges. The app receives only SELECT and INSERT. It cannot UPDATE or DELETE existing evidence; the signer role cannot read it. A composite foreign key binds each calculation's balance UUID **and** account ID to the same owned observation. Owner-scoped validation checks external account identity as well as IDs.

These are application-role append-only records, not tamper-evident or administrator-proof storage. A privileged migration administrator can still alter them. JSON types/object checks do not constitute a cryptographic integrity proof. No untrusted route may directly insert caller-constructed snapshot JSON; future financial consumers must use the trusted capture contract.

Database errors expose fixed `CalculationStoreError` codes/messages without SQL, driver details, labels, amounts, or identity data. Invalid input is rejected before writes. Inserts and reads of a new calculation share a transaction, so failed insert/query work cannot leave a partial calculation.

There is no automatic record deletion. These rows retain user-supplied commitment labels and financial planning amounts; they belong behind the existing ownership boundary. Retention and account deletion policy remain a later requirement before deployment with actual personal data.

## Handoff: HL-18, HL-21, and HL-23

### HL-18: verified balances

Add a separate, validated provider evidence path. Do not relabel fixture rows or relax source handling with a client flag. Verify exact listing/chain/venue, available/held semantics, source response provenance, fetch timestamp, and consistency limitations. Fixtures and provider observations must remain visibly distinguishable. Schema changes and adapter contract tests must accompany the provider path. Only then connect balance refresh to capture and the planning interface.

### HL-21: review preparation

Persist the calculation UUID and policy revision used for a review. Recheck current policy, local date/timezone, selected balance identity/freshness, source, eligibility, and operation constraints. Do not infer authority from a historical `get` or an earlier `status` result. Review creation must use the account transaction/operation-slot protocol; it cannot separately check a revision and later reserve an order without a race guard.

### HL-23: explicit approval

Within the approval transaction holding the account lock, validate the review's original calculation revision and balance basis against current state **before** committing signing/execution authority. Provider/fee/debit terms and explicit user approval are separate requirements. Do not hold a database transaction open for provider network calls.

Required later regression: create a review from revision N, edit a policy or commitment to N+1, then submit the original review approval. Reject it as stale before any signing or execution request. Also exercise an approval/plan-edit race, timezone/local-midnight invalidation, fresh-but-superseded evidence, fixture-source rejection, and expired balances. HL-16 validates storage/invalidation with real PostgreSQL; it does not claim final order-approval enforcement exists.

## Validation and limits

The integration suite covers historical preservation after an edit and store recreation; exact 300-unit debit budget; no implicit acknowledgement; stale revision rejection; cross-owner reads and inserts; composite foreign-key ownership; runtime update/delete denial; signer read denial; explicit fixture-only provenance; freshness/future-clock bounds; timezone/midnight changes; newer observations at identical timestamps; capture/edit concurrency; active-operation blocking; transaction failure redaction; and idempotent migration reruns.

No real provider, Supabase email, browser/UI, deployed database, trading, or deployment experiment is performed in this slice. The migration is exercised against the dedicated disposable local database only.

A nonblocking follow-up is to distinguish aggregate money-range failures from temporary storage failures in the future planning UI. An individually valid commitment and buffer can have an unsupported aggregate; capture currently rejects safely with `unavailable`, but that message does not explain the needed plan edit.
