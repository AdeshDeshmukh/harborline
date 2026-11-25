# Planning interface (HL-17)

## User journey

Signed-in users reach `/plan` and `/overview` from their account. Each page verifies its own owner context; the layout alone is not authorization. Proxy session refresh and private/no-store behavior now include both routes. No public demo or financial action route is added.

The planning page shows:

1. A persistent sample-balance notice: fictional 2,000 USDC, no real funds or wallet-balance claim.
2. A shared server-calculated explanation: sample cash, included commitments, additive buffer, remaining room, and shortfall when needs exceed cash.
3. An explicit horizon/buffer confirmation and acknowledgement about omitted commitments.
4. One-time commitment creation, editing, paid/restore status, and reversible removal.
5. A hypothetical amount preview, calculated on the server from refreshed sample evidence. It does not create an order, reserve funds, or change commitments.

The overview uses the same result view and points users back to their plan. There are no investment, funding, or live eligibility controls. Values are in USDC-equivalent planning units, not local bank-currency balances.

## Code boundaries

- `screen.server.ts` coordinates the existing owned planning service and HL-16 calculation store; it does not duplicate the allowance formula.
- `screen-types.ts` contains the client response contract. Snapshot results, explanations, and hypothetical projections come from the server.
- `(planning)/actions.ts` checks the exact configured Origin and independently authenticates each action. It uses the existing service's strict input and optimistic revision validation. Next.js also provides its Server Action request protections; action IDs are not treated as authorization.
- `planning-workspace.tsx` manages drafts, accessibility, presentation, and pending/error feedback. It uses exact formatting helpers for display only. No browser money calculation authorizes any action.
- `(planning)/plan` and `(planning)/overview` are dynamic protected pages. Loading/error boundaries offer recovery without exposing dependency errors.

All fixture observations remain source-constrained in the database. Initial page rendering only reads existing owned snapshots; it never appends or supersedes balance/calculation evidence. Explicit reload, save, and hypothetical preview are authenticated POST actions that obtain fresh sample evidence and capture a persisted calculation when a policy exists. There is no background provider polling. Browser freshness checks use timestamps to label the illustration historical after 15 seconds; they do not grant financial authority. New screen responses also update the local display clock immediately, avoiding a transient false future-timestamp label.

## Writes, conflicts, and recovery

All actions submit the server-issued account scope as a comparison guard. The server derives ownership from the current session and rejects a scope mismatch; scope never selects the owner. If another tab switches accounts, the old page requires full navigation before editing, refreshing, or previewing. New page instances are keyed by account scope.

All mutations submit the displayed expected revision. The interface has no optimistic monetary updates or automatic write retry. A confirmed save is returned with its saved plan even if the subsequent explanation refresh fails; this prevents users being told to resubmit an already-saved commitment. An explanation failure hides the result and offers reload.

A stale revision, missing record, active operation, uncertain response, or unavailable storage requires reload before editing resumes. Validation errors preserve the commitment draft, focus a readable alert, and leave the form editable. Pending work disables forms and prevents duplicate clicks. An edit also preserves its original row revision. If a refresh, preview, or local status change reveals that row changed, saving the old draft is disabled until the user explicitly discards it and loads the latest version. An unchanged row can still be edited after unrelated plan changes. Exact same-name/amount/date duplicate suspicion requires explicit confirmation before adding a separate commitment. Soft removal remains visible and can be restored. Paid and removed entries are excluded by the server calculator. Editing a paid entry does not silently mark it outstanding.

Inputs have associated labels, native required/date/precision constraints, positive-amount validation on the server, explicit acknowledgement, and focus-visible controls. Edit moves focus to the commitment name. Error messages receive focus. Status text announces pending work and confirmed saves. Refresh/preview announcements reflect explanation failures rather than claiming success; preview failure also appears beside its form. The unexpected-error boundary uses the installed Next.js `retry()` API to refetch failed server content. The interface uses a single-column layout at narrow widths and allows controls and long values to wrap.

The store's generic error for an aggregate outside its amount range remains a known limitation from HL-16. The UI safely withholds an explanation and permits editing the plan; it does not manufacture an allowance.

## Verification scope

Unit tests cover the controller, exact hypothetical arithmetic, invalid inputs, authentication, stale-write guidance, committed-save/explanation-failure separation, caller identity-field rejection, and action Origin/session checks. Existing database suites cover owner isolation, planning revisions, immutable snapshots, and role grants.

Browser verification uses the built Next.js application, actual Supabase SSR SDK with a loopback simulated authentication service, and disposable PostgreSQL. No actual authentication email, Gateway customer, funding, trading, deployment, or live migration is performed. Screen reader announcements are inspected through browser accessibility state; no claim of a complete assistive-technology audit is made.

## Handoff

HL-18 must replace the fixture balance adapter with verified, source-labeled provider evidence under its contract. Do not simply change the displayed number or mark fixture rows as provider observations. Final stale-review/approval enforcement still belongs to HL-21/23. This interface never treats an allowance as a suitability guarantee or a trading permission.
