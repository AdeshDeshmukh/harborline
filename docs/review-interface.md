# Investment review interface — HL-22

## Implemented surfaces

- `/assets/[id]`: an explicit unavailable state while supported catalog/issuer evidence is unverified. No listing, issuer URL, price, balance or preparation is fabricated.
- `/review/[intentId]`: an authenticated, owned, read-only view of stored review terms and current invalidation context.
- `/sample/asset` and `/sample/review`: public fictional examples for inspecting the interface without credentials. They never connect to a database or provider, prepare an order, sign, or execute. The fixed 100 USDC example and illustrative timestamps are labeled; opening a new illustration restarts its fictional time window. These are not saved live reviews or proof of integration.

Sample review links also illustrate expired, changed-plan and unavailable states. They change only the displayed fictional scenario. The complete public walkthrough remains HL-29.

## Saved terms and current context

The screen reader locks the owned account for share, validates the context's owner/account/external reference, and reads intent, latest immutable review, calculation, current policy/timezone/date and balance evidence in one transaction. State writers take the account update lock, so the reader cannot combine an old review with a newer operation state.

The query selects the public review terms, not ciphertext, nonce/tag or encryption-key version. The existing stored-terms hash is checked before projection, and stored debit/expiry columns must match its hashed bounds. Quote and cash objects are projected field by field, so unknown persisted metadata cannot become browser props. Browser props omit payload text/digests, signed material, tokens and vault fields. No encryption key or signer is initialized for a page read.

“Read-only” describes the review-domain transaction and reload operation. Shared authentication still uses the existing local identity bootstrap: a first verified visit can create a local profile/account row. It does not provision a provider customer or move funds. This slice preserves that shared identity behavior rather than introducing another authentication path.

Numbers come from the saved review projection. Exact decimal formatting groups thousands and pads short money fractions without rounding away fee or maximum-debit precision. The before/after explanation uses the recorded maximum debit and preserves the saved commitments and additional buffer. A plan describes intended use rather than locking funds.

The UI shows requested input, expected token quantity, quoted fee/denomination, whether that fee is included or added, maximum debit, remaining cash, chain/venue, exposure description, missing issuer evidence and observation/expiry timestamps in UTC. No confirmed fill or success styling is inferred from a review.

## Blocking and time

Current sample terms remain non-actionable: there is no approval button or form. Every screen has `canProceed: false`, and the saved review keeps its false approval/execution flags. Expired, changed, superseded, missing and stale terms cannot proceed. Explicit unsigned EXPIRED is shown as expiry even after cleanup releases its slot. SUBMITTING/PENDING/UNKNOWN/MANUAL_REVIEW remain uncertain rather than being relabeled as safe unsigned expiry.

Only the isolated public example promises “no real funds.” Owned records with validated fixture terms identify those stored figures as illustrative. An owned operation without verified terms uses neutral source wording and never promises that funds could not have moved.

Current-context checks include account policy revision, calculation policy/date/timezone, matching operation slot and generation, latest selected balance, its 15-second age, and the saved quote's local deadline. A future approval endpoint must independently recheck all authoritative inputs; this screen does not implement approval authority.

Browser time combines the server observation with elapsed monotonic time and the current wall clock conservatively. It does not move backwards within a displayed review. The reader supplies the balance freshness deadline, so a still-current quote becomes stale when that earlier window lapses. Quote expiry is end-exclusive; balance age remains valid through exactly 15 seconds, matching storage checks. Elapsed quote age is shown separately from time remaining and keeps updating for historical terms. No timer creates a request, renews terms or enables an action. Exact UTC expiry remains visible. Browser time is an informational display, never authorization.

Reloading an owned review uses a server action that verifies the session again and compares the prior account scope. A changed/ended session clears old terms and shows sign-in guidance. Errors are bounded and never expose SQL, credentials or raw dependency messages. Reload is a saved-record read, not a new quote or preparation attempt.

## Presentation choices

This slice retains Harborline's current dark/navy, cyan and restrained amber styling to avoid a separate redesign of existing planning screens. The original warm-canvas direction can be revisited as a deliberate product-wide design change.

The sample amount is read-only because no custom preparation path is enabled. Its working action inspects the fixed illustration. Live asset selection remains unavailable until verified listing/issuer and preparation contracts exist. No disabled purchase button is presented as a working trade.

The interface uses semantic headings and definition lists, a skip link, visible focus outlines and live status announcements. Expiry announcements do not steal keyboard focus; explicit reload errors receive focus. Layout and exact values were checked at 1280px and 360px widths. This is focused accessibility verification, not a full WCAG audit.

## Verification and remaining limits

Unit/render tests cover screen invalidation, exact amounts, sample isolation, fee/cash rendering and session/error guards. Real disposable PostgreSQL tests cover owned reads without a vault, cross-owner denial, unchanged saved terms after policy changes, stale/expired evidence and uncertainty that survives age.

Local production browser checks cover the sample asset/review flow, automatic expiry, changed-plan/unavailable examples, absence of purchase controls, no horizontal overflow, skip-link focus, and anonymous redirect on the owned-review route. No authenticated browser session or deployed environment was exercised; owner isolation and session changes were verified through repository/controller tests.

HL-18/19/21 live activation gates remain unchanged. No new migration, provider mutation, signature, trade or settlement logic is added. HL-23/24 own approval/execution and must not treat this UI or any fixture record as authority to trade.
