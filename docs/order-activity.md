# Saved order activity and receipts (HL-27)

## Behavior

`/activity` lists the signed-in owner's saved investment requests, newest first,
in pages of 20. `/activity/[intentId]` joins the saved request, its exact approved
review and planning revision, accepted actual evidence, and any manual cash
verification. Manual reload reads local saved records. It never prepares,
executes or retries an order, runs recovery, or calls Gateway.

`GET /api/activity` accepts one optional `cursor`; `GET /api/investments/[id]`
accepts no selectors. Responses use private/no-store headers. Server actions
reauthenticate and compare the original account scope. A failed reload clears
private screen content; an ended/changed session requires reopening the account.
The public sample routes use fixed fictional records, never an account reader.

## Integrity and privacy

The reader verifies owner/account/external-reference binding under the existing
owner-scoped database role and row-level policies. An account SHARE lock keeps
cooperating financial writers from changing the record between joined reads.
Statements have five-second timeouts and locks a three-second timeout. The cursor
is bounded canonical base64url JSON containing account ID, record ID and the exact
PostgreSQL UTC microsecond creation timestamp. It is a pagination position, not
an authorization token; ownership is checked independently on every request.

Only explicit display fields enter DTOs. Approval reads exclude ciphertext,
nonce/tag and key version; unknown actual-evidence JSON fields are dropped.
Provider-user identities, operator identities, manual proof references, signer
material and raw errors are not returned. Unknown/other-owner IDs have bounded
not-found responses. No private data is stored in browser storage.

## Receipt semantics

- The original approval is selected by its immutable review revision and terms
  hash, including the approved network. Planning dates are validated before
  projection rather than trusting a JSON field's static TypeScript type. Current
  policy revision, quote expiry and the newest account balance do not replace
  historical decision inputs.
- Cash at approval comes from the saved terms checked against the approval's
  fresh balance snapshot. That snapshot can have a different ID from the earlier
  calculation snapshot; their original economics were checked at approval.
- Filled quantity, remaining quantity, average price and fee are actual accepted
  report fields. Null remains “Not recorded,” never zero or a quote estimate.
- Accepted report time belongs to that observation. A later failed or ignored
  check has its own displayed timestamp (ordered by recording time, with request
  sequence as a deterministic tie-breaker) and cannot re-date accepted evidence.
  These are recording times, not provider execution or chain timestamps.
- A verified receipt uses the immutable verification's exact order read and
  settlement balance, cross-checked against its saved post-settlement baseline.
  Later account balance changes do not alter this receipt's pre/post cash.
  Other credits/debits from the same verification are displayed when nonzero;
  the reader checks pre-cash + other credits − order debit − other debits = post-cash.
- Complete/failed/canceled outcomes are separate from cash verification. Partial
  failure may have acquired assets. Any recorded conflict remains prominently
  flagged. Neutral review wording also covers manual holds with consistent reports. The reservation shown belongs to this order only; it is not a claim
  that the current account is available for another operation.
- No chain transaction hash or explorer URL is persisted by the existing schema.
  This UI says “Not recorded” and ignores unrecognized link metadata. There is
  no invented explorer link or alteration to financial normalization/idempotency.

## Local examples and remaining limits

`/sample/activity` and its fixed pending, unknown, complete, verified,
partial-failed, review and empty examples share the private screen renderer.
Every example says “Sample · no real funds.” They establish presentation only;
they are not authenticated persistence, provider, settlement or production proof.
The full public journey is HL-29.

Live provider paths remain disabled. Real Supabase authentication, deployed
migrations/database policies and private provider integration need separately
configured accounts and controlled evidence. Local tests do not establish
eligibility, provider-supported quote assets or a working live submission.

## Verification

Regression tests cover cross-owner access, exact timestamp pagination,
malformed/scoped cursors, persisted unknown outcomes, immutable historical cash,
accepted-report versus later-check timestamps, missing actuals, conflicting
terminal reports, corrupt approval terms and dropping private/URL extensions.
Controller/handler tests cover auth, scope changes, strict selectors, bounded
errors and private/no-store responses. Shared-renderer and refresh-state tests
cover truthful status text and clearing data after errors/session changes.
Final run evidence follows.

Browser inspected actual CSS widths 360 and 1280 with no horizontal overflow,
keyboard activation/focus, fictional history/receipts/empty state, reload and
signed-out `/sign-in` redirect. No authenticated browser refresh or cloud/provider
flow was exercised. A fresh independent review identified receipt projection,
timestamp and status-copy gaps; each was covered by a failing regression and
fixed in one pass. After that pass, all 666 tests passed (6 provider-script, 389 unit/contract,
271 PostgreSQL). Lint, typecheck, production build and post-build typecheck
passed. No dependencies, database schema or migrations changed.
