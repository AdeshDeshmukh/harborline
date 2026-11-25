# Planning persistence — HL-15

Harborline can save an authenticated user's planning policy and dated commitments
through server-side APIs. This slice adds persistence and conflict handling, not
the planning interface, automatic bill detection, bank connections, bill payment,
balance retrieval or investment execution.

## Storage and ownership

Migration `drizzle/0002_planning_storage.sql` adds:

- `harborline.planning_policies`: one policy per local account, explicit 1–90 day
  horizon, nonnegative additional buffer, global revision and acknowledgement time.
- `harborline.commitments`: database-generated UUID, account/policy FK, label,
  positive amount, local due date, outstanding/paid/removed status and record revision.
- An account/due-date index, restrictive foreign keys, numeric/date/revision/label
  constraints, owner policies and FORCE ROW LEVEL SECURITY on both tables.

Amounts use `NUMERIC(38,18)` and remain strings in application/JSON values. DB
constraints require cent-aligned economic values and explicitly exclude `NaN`.
HTTP validation rejects excess entered precision before SQL; PostgreSQL's numeric
cast can round over-scale raw SQL, so database constraints do not replace that
input validation. Dates are local calendar strings from years 0001 through 9999.

Only `harborline_app` has SELECT/INSERT/UPDATE privileges. Public and signer-store
roles have no access to these tables, and the app has no physical DELETE grant.
RLS resolves table ownership through the account row and transaction-local verified
owner setting. Every repository operation also matches the context's owner UUID,
account UUID and stable external reference. Caller-supplied ownership fields are
not accepted by the service schema.

As elsewhere in this repository, this trusts the authenticated server to construct
OwnerContext; it cannot protect against compromise of that trusted server. Never
deserialize a context from a browser request or expose the repository directly as
a Server Action.

## Explicit policy and revisions

GET returns `policy: null` and an empty commitment list for a new account. It does
not create or acknowledge a default 30-day policy. The first save must explicitly
supply horizon, buffer, acknowledgement and the revision from the latest GET.
Commitments require an initialized policy; its FK also enforces this in storage.

Every edit locks the owned account, requires the current `expectedRevision`, and
increments `gateway_accounts.policy_revision` and `planning_policies.revision`
together. Policy initialization normally advances the account's revision 1 to 2.
Creating or editing a commitment advances that same global revision. Individual
commitments start at revision 1 and increment on edits/removal/restoration.

Reads take a shared account lock so the returned revision, policy and commitments
form a coherent view relative to this repository's writers. Mutations take the
account update lock, validate targets before writing, and commit all changes in
one transaction. A failed data/revision write rolls back the entire mutation.
Lock waits are limited to three seconds and statements to five seconds.

Concurrent requests using one expected revision produce one winner and a conflict;
there is no automatic merge or retry with a newer revision. The client must reload
and reconcile its draft. This also conflicts edits to different commitments, a
deliberate cost of one simple revision that later calculation snapshots can bind.

Any active account operation currently blocks edits while leaving reads available.
This conservative guard uses the existing operation slot; state-specific behavior
can be refined when the order lifecycle exists. Planning revisions now persist,
but immutable calculation snapshots and stale-investment-approval rejection are
still HL-16 and later work.

## API contract

All routes require pilot Auth configuration and the verified server session.
They use the restricted runtime database connection. Planning access does not
require investment eligibility or a provisioned wallet; those remain separate
gates on later financial actions.

| Method and route | JSON body | Success |
| --- | --- | --- |
| `GET /api/plan` | None | `200` current plan |
| `PUT /api/plan` | `expectedRevision`, `horizonDays`, `additionalBuffer`, `acknowledged: true` | `200` saved plan |
| `POST /api/commitments` | `expectedRevision`, `label`, `amount`, `dueDate` | `201` current plan including created commitment |
| `PATCH /api/commitments` | `expectedRevision`, `id`, and at least one of `label`, `amount`, `dueDate`, `status` | `200` updated plan |
| `DELETE /api/commitments` | `expectedRevision`, `id` | `200` plan with target marked removed |

Example policy request:

```json
{"expectedRevision":1,"horizonDays":30,"additionalBuffer":"500.00","acknowledged":true}
```

Example commitment request after policy save:

```json
{"expectedRevision":2,"label":"Rent","amount":"1200.50","dueDate":"2026-12-01"}
```

Amounts must be strings and entry precision is at most two places. Labels are
trimmed, nonempty, at most 120 UTF-16 code units, with control characters rejected.
Commitment IDs are UUIDs; IDs for creation come only from the database. Unknown
fields, invalid dates/statuses, empty patches and unsupported revisions are errors.
Mutating requests must leave room to increment a positive 32-bit revision.

The response is `{ revision, policy, commitments }`. Policy contains horizon,
canonical buffer, its matching revision and an ISO acknowledgement timestamp.
Each commitment contains its ID, label, canonical amount, dueDate, status and
record revision. The response includes all statuses, sorted by due date then ID.
Removing a record retains its ID/history and can be reversed with an explicit
PATCH to `outstanding`. No hard-delete endpoint or automatic cleanup is included.
GET currently returns the whole small-pilot plan; pagination is not implemented.

## HTTP and failure handling

Mutations require the exact configured application Origin and `application/json`.
Bodies are streamed with an 8 KiB limit and strict UTF-8 JSON decoding. No request
Host or forwarded header chooses the trusted origin. Handlers derive ownership
themselves and construct database/service dependencies lazily after those checks.

All success and error responses use private/no-store headers. Errors have bounded
`code`, `message`, server-generated `requestId` and `recoverable` fields. They do
not echo labels, financial values, raw SQL, connection strings or dependency errors.

| Status | Meaning |
| --- | --- |
| `400` | Invalid JSON, schema, money/date or revision input |
| `401` | No verified signed-in identity |
| `403` | Mutation Origin missing or mismatched |
| `404` | Record unavailable to this owner, including another owner's target |
| `409` | Stale revision, uninitialized policy or active account operation |
| `413` / `415` | Body too large / unsupported content type |
| `503` | Configuration, Auth account resolution or database unavailable |

The handlers deliberately do not log raw errors or request bodies. Hosting-side
logging and deployed session behavior still require environment verification.

## Migration and rollout

The applied `0001_account_foundation.sql` is unchanged. The new journal entry is
zero-based index 1 with SQL tag `0002_planning_storage`; its generated snapshot is
`0001_snapshot.json`. The custom FORCE RLS and privilege statements are reviewed
SQL not fully represented in the ORM snapshot. Preserve them on future changes.
Schema generation reports no drift, and rerunning migrations preserves saved data.

No live database migration is authorized or performed here. Before an authorized
pilot deployment, apply the new migration using the existing explicit migration
runner and administrator connection, then verify the restricted runtime role.
Do not give migration credentials to the application. A pilot server missing this
migration returns a sanitized unavailable response from planning APIs. There is
no automatic deployment migration or destructive down migration; prefer forward
corrections and preserve existing planning records.

## Validation and remaining work

Tests exercise strict service inputs, Auth/origin/body/error handling and real
PostgreSQL persistence, forced RLS, two-user isolation, forbidden role/delete
access, numeric constraints, revision races, rollback, active operations and
migration reruns. Test credentials and personal/financial examples are synthetic;
all schema resets and writes are confined to explicitly disposable harborline_test.

Local Node 24 verification passed 157 tests (6 provider-checker, 112 unit/contract,
39 PostgreSQL), lint, type checking, production build and schema-generation drift
checks. A built-app HTTP check exercised the actual SSR Auth SDK with a loopback
simulated Auth service and real disposable PostgreSQL: explicit policy save,
commitment create/edit/remove, reload persistence, stale-revision conflict,
cross-origin/caller-identity-field rejection and API denial after sign-out passed.
No real email or external provider was contacted. Independent read-only review
found no blockers and separately ran the 11 API/service tests. Optional coverage
for the shared active-operation guard on every mutation method remains deferred;
the database test currently exercises creation through that common guard.

HL-16 adds immutable calculation snapshots and revision invalidation evidence.
HL-17 adds the planning interface and its conflict/recovery presentation. Profile
timezone editing, real Supabase/deployed database verification, provider integration
and financial authorization are not completed by these storage APIs.
