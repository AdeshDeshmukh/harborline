# Account ownership — HL-11

## Boundary and request flow

`requireOwnerContext()` in `src/features/identity/access.server.ts` resolves the
current browser's server-verified Supabase identity, then bootstraps that user's
local profile and account mapping. It accepts no request body, owner ID, account
ID, or provider user ID. An absent verified session fails before database access.

The result is an immutable server-only `OwnerContext`: owner UUID, local account
UUID, stable external reference, current provider/provisioning fields, profile
timezone and access flags, and the verified email. This type is not a credential
and its TypeScript brand is not a runtime authorization mechanism. Never rebuild
it from JSON, cookies, URL parameters or request bodies. It must stay on the server;
render only the fields the user needs.

The account route's dynamic layout and page both use this boundary. A React
`cache` wrapper deduplicates their work within one Server Component render; it is
not a process-wide session cache. The page independently resolves the context
because a layout can be reused during navigation and does not prevent child
segments from rendering. Future handlers and mutations must call
`requireOwnerContext()` themselves, then scope every database operation to that
context and independently enforce the relevant pilot/eligibility/action rules.

Missing identity redirects to sign-in. A database/bootstrap failure becomes a
fixed account-unavailable state with retry and sign-out, avoiding the loop where
an already authenticated user is repeatedly redirected between sign-in and account.
Raw queries, connection strings, identities and driver errors are not returned.

## Atomic local bootstrap

`src/features/accounts/repository.server.ts` contains the narrow bootstrap
repository. Its `VerifiedIdentity` parameter is a trusted internal input supplied
by the access boundary, never a browser DTO. The helper performs no independent
authentication; do not expose it directly as a route or Server Action.

One existing `withOwner(identity.id, ...)` transaction:

1. Checks the runtime role, sets the restricted app role and transaction-local
   owner setting used by forced PostgreSQL RLS.
2. Inserts a profile using only `auth_user_id`, preserving database defaults:
   timezone `UTC`, pilot disabled, eligibility `UNKNOWN`.
3. Inserts one `UNPROVISIONED` account mapping with a database-generated UUID and
   an opaque server-generated `hl_<random UUID>` external reference.
4. Uses owner-keyed `ON CONFLICT DO NOTHING`, then reads the joined profile/account
   in a separate statement. Returning logins retain the original account ID and
   external reference, all access flags, and existing provisioning state.
5. Commits both records together or rolls both back on failure.

This uses PostgreSQL's normal `READ COMMITTED` isolation. A separate select sees a
concurrent insertion after the unique-key wait; a single-statement insert/CTE
could miss that winning row in its earlier snapshot. The profile primary key and
unique account owner constraint are the concurrency arbiters. The external
reference also has a global unique constraint: a collision fails closed instead
of reassigning an existing reference. A new candidate on a later login never
replaces the stored reference.

The profile insert intentionally names just the authorized column in SQL. A
Drizzle insert listing protected columns with `DEFAULT` would still require
column privileges that the runtime role must not have. All values are bound
parameters. The account insert and joined read use the existing Drizzle schema.

## Scope and trade-offs

- No schema or migration changes. Existing unique constraints, restricted roles,
  column grants and forced RLS enforce storage isolation.
- One local mapping is prepared on the first authenticated account-page visit.
  An email callback alone does not create a Gateway customer.
- Bootstrap is idempotent and has no external side effects. It does not call
  True Markets, allocate a wallet, generate/store a signer, or enable investment.
- Returning visits currently perform conflict-safe insert attempts and a read.
  This keeps initialization/recovery simple at the cost of additional statements
  and per-owner lock contention during concurrent visits. No extra cache or queue
  is introduced for this small pilot.
- Owner context proves local ownership only. Pilot and eligibility flags are
  data, not an automatic grant. The app role cannot promote those profile flags.
- RLS trusts the authenticated application to select the correct owner setting;
  it cannot defend against a fully compromised trusted server with its DB role.
  Retain server-only imports and review every new boundary. The private signer
  role remains separate.
- Email is not the durable owner key and is not copied into account records.
  Identity UUID changes/account deletion/recovery still need an explicit process;
  this slice does not merge identities by matching email.

## Evidence and remaining limits

Tests use a disposable PostgreSQL 16.15 database with the real migration and
restricted runtime role. The HL-11 tests cover:

- Default local profile/account creation without a signer or provider identity.
- Eight concurrent first logins resolving to one account and external reference.
- Returning login preserving timezone, eligibility, access flags, provider identity,
  provisioning state and policy revision.
- Forced account-insert failure rolling back the new profile.
- Verified-context-to-RLS isolation: A cannot read or update B's account/profile,
  and supplied owner/account/provider IDs do not select the context.
- Missing sessions denying bootstrap, distinct sessions staying separate,
  inconsistent mapping rejection, sanitized failures, and account navigation.

Local verification on Node 24 passed 70 tests (6 provider-checker, 49 unit/contract,
15 PostgreSQL), lint, type checking, and a credentials-free demo production build.
A built-app HTTP check used the actual Supabase SSR SDK with loopback simulated
Auth and the real disposable database. It completed signed-out redirect, PKCE
callback, account reload, signed-in redirect, logout and access removal. The
database contained exactly one local mapping for that synthetic identity with
pilot disabled, eligibility `UNKNOWN` and provisioning `UNPROVISIONED`.

Independent read-only review found no blockers. Fixed, non-sensitive operational
diagnostics for bootstrap failures remain an improvement for later observability
work; this slice deliberately exposes only a generic recoverable user message.

The identity boundary tests substitute a verified Auth response; HL-10 separately
tests the actual Supabase SSR SDK against simulated Auth responses. Neither proves
real email delivery, deployed Auth-to-database wiring, Supabase pooler behavior,
or remote role configuration. Those checks still require a configured, explicitly
authorized environment. There is no migration or account creation against a live
environment in this slice.

HL-12 remains gated on the provider contracts already recorded in the feasibility
documents. Local owner context does not resolve those gates or authorize a live
provider provisioning experiment.
