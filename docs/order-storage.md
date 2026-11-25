# Durable order intent storage — HL-20

## Scope and authority

This slice adds local investment intents, append-only audit events, account-slot ownership constraints, and tested compare-and-set lifecycle helpers. It introduces no API route, wallet signature, provider request, approval endpoint or execution attempt. Every intent view has `canExecute: false`.

A stored state is not proof of a provider fill or user approval. Fixture-mode records model the lifecycle only. Default preparation safety is unverified; there is no environment switch that establishes provider guarantees. Live access and quote/debit gates from HL-18/19 remain unchanged.

## Storage

`investment_intents` records account, operation kind, exact requested quantity/unit, selected asset ID, optional owned calculation, policy revision, request key/hash, local state/revision, preparation generation/lease, local review expiry, provider order reference, safety provenance, possible-effects flag and timestamps.

`audit_events` stores account/intent association, acting owner reference, ordered sequence, event type, bounded redacted metadata and occurrence time. No signed payload, key, signature, raw dependency error or arbitrary client metadata is stored by these helpers. Sequence ordering remains deterministic when timestamps match.

The additive `0004_order_storage.sql` migration:

- Creates both tables with forced owner RLS.
- Adds unique account/request-key and intent/account identities.
- Binds calculations and audit intent references to the same account with composite foreign keys.
- Binds `gateway_accounts.active_operation_id` to an intent owned by that account.
- Grants app-role SELECT/INSERT and only lifecycle-column UPDATE on intents; request economics, ownership, request key/hash and provenance cannot be updated by the app role.
- Grants no app-role DELETE and no audit UPDATE. Signer/public roles receive no new table access.
- Enforces positive finite quantities, valid sizing units/precision, finite timestamps, state field requirements, and monotonic safety fences.

The calculation/account unique constraint is installed before the intent foreign key that needs it. Existing migrations/snapshots remain unchanged. The new account-slot constraint deliberately fails if a pre-existing non-null slot points to no owned intent; investigate such data rather than clearing it silently. No live database migration was performed.

The update trigger requires revision increments of exactly one, nondecreasing preparation generations with at most one increment per update, and a possible-effects flag that cannot be cleared. Financial/unknown records cannot move back into unsigned states, and terminal states cannot regress. A database constraint permits REVIEW_READY/SUBMITTING only with fixture provenance in this slice; the trigger allows entry into SUBMITTING only from REVIEW_READY with no prior possible effects. These are application-role safeguards, not administrator-proof records or execution authority.

## Request identity and account serialization

`normalizeIntentRequest` accepts only a bounded request key, operation kind, listing ID, positive decimal quantity, quantity unit, optional calculation ID, and expected policy revision. Buys use quote units and require a calculation; sells/exits use base units. Buy/exit precision is six decimals; sell precision is bounded to eighteen until the selected listing's exact scale is checked during preparation.

Amounts and UUIDs are canonicalized. A versioned SHA-256 hash covers the economic request and calculation/policy association. Thus `100.00` and `100.000000` replay the same request, while changed quantity, asset, operation or calculation context conflicts. The hash is correlation data, not authorization or a secret.

`claim` locks the owned account for update. It resolves an existing account/key before checking the current slot or policy: same hash returns the original intent, even if it is now expired or another operation owns the slot. Replay never reacquires a slot or changes an old state. A changed hash returns `request_conflict`.

A new request requires an empty slot, matching policy revision and an owned calculation at that revision when supplied. Insert, slot claim and audit are one transaction. The slot write also requires an empty slot and verifies its returned intent ID; a suppressed or altered write cannot report a successful claim. Competing requests serialize on the account row. A failed SQL write or domain conflict rolls back every earlier write in that transaction.

This storage check does not replace live balance freshness, asset eligibility, allowance/debit limits or payload checks. Those belong to preparation/approval. Existing planning writes conservatively block while any slot is occupied. State-aware plan editing remains a future interface change; storage still rechecks policy revision before preparation, accepting a prepared response and entering SUBMITTING.

## Repository operations

`createIntentRepository(database?, {fixtureMode?, clock?})` is server-only and lazy by default. No route composes it. Every method requires the verified server owner context; actor/account/provider selection is not accepted from a browser.

| Method | Behavior |
| --- | --- |
| `claim` | Atomically deduplicate or create DRAFT and claim account slot |
| `get`, `audit` | Owner-scoped coherent reads; audit ordered by sequence |
| `beginPreparation` | DRAFT → PREPARING; increment generation and set a 30-second lease |
| `finishPreparation` | Fence by active slot, intent, revision, generation, lease, policy and review deadline |
| `advance` | Local state CAS; no signature, approval proof or provider execution |
| `cleanup` | Apply only the defined age/deadline predicates |
| `abandon` | Release definitely unstarted/fixture-unsigned work or retain UNKNOWN |
| `rejectPreparation` | Release a fixture-confirmed unsigned rejection; otherwise retain UNKNOWN |

All mutations acquire the account lock first. There is a three-second lock timeout and five-second statement timeout; no network or signer work runs inside these transactions. Domain errors are carried outside the generic DB wrapper only after forcing rollback, so an error after an intent write cannot accidentally commit partial state.

## Preparation generations and late responses

Each start increments generation. Fixture-confirmed PREPARING work may restart only after its old lease ends, with no provider ID or possible effects. Unverified preparation cannot restart from lease age alone.

A response can establish the local REVIEW_READY model only when the slot still points to the same intent, revision/generation and PREPARING state match, lease is live, policy is current, and local review deadline is positive and at most 20 seconds ahead. This state is available only for explicitly labeled contract fixtures here. A matching but unverified response becomes UNKNOWN and retains the slot.

Stale, expired or superseded responses append `preparation_response_ignored` with their bounded validated provider reference and generation. They do not update the intent or clear/change another operation's slot. Provider references currently support a bounded portable ASCII identifier subset; a future adapter must retain unsupported/malformed responses through its incident workflow rather than silently treating them as valid preparation.

HL-21 must additionally persist immutable terms and exact payload evidence atomically with its preparation outcome. Current REVIEW_READY fields do not constitute a complete executable review.

## Cleanup and possible financial effects

| Case | Local outcome | Slot |
| --- | --- | --- |
| DRAFT idle for 10 minutes | ABANDONED | Release matching slot |
| Explicit unstarted DRAFT abandonment | ABANDONED | Release matching slot |
| Fixture-unsigned PREPARING lease expired | EXPIRED | Release matching slot |
| Unverified PREPARING lease expired | UNKNOWN, effects possible | Retain |
| Fixture-unsigned REVIEW_READY expired or policy changed | EXPIRED | Release matching slot |
| Unverified review uncertainty | UNKNOWN, effects possible | Retain |
| Fixture-confirmed unsigned rejection/abandonment | REJECTED/ABANDONED | Release matching slot |
| SUBMITTING, PENDING, UNKNOWN, MANUAL_REVIEW | No age-based release or resubmission | Retain |
| COMPLETE, FAILED, CANCELED | No settlement clearance in this slice | Retain |

Cleanup deadlines are end-exclusive: at lease/review expiry it is too late to accept a response or enter SUBMITTING. Expiry and submission race under the same account lock. Entering SUBMITTING sets the possible-effects fence before any future external work. There is no transition back to SUBMITTING from UNKNOWN/PENDING or any financial state. A lease does not establish that a prior attempt was never sent.

Financial terminal states do not free money or permit another account operation. HL-24/26 must add the verified settlement/manual reconciliation predicate before clearing those slots. Merely observing a terminal status, unchanged balance or elapsed time is insufficient.

## Verification and handoff

Real PostgreSQL tests cover concurrent same-key replay, changed-body conflicts, competing keys, account/calculation ownership, slot foreign keys, immutable request/audit grants, generation fencing, ignored late references, review deadline races, one winning submission CAS, financial non-regression, fixture versus unverified cleanup/rejection, matching unverified responses, replay after slot replacement, audit failure rollback, domain-conflict rollback, suppressed slot-claim rollback, direct database rejection of unverified review/submission regression, unscoped/signer access denial and migration reruns.

Older planning lock tests now seed valid owned fixture intents instead of dangling random slot IDs. They continue to verify that planning writes/captures remain blocked during active operations.

HL-21 owns actual order envelope/route/payload verification. HL-23 owns atomic approval and a unique execution-attempt record before any signing/execution; `advance` is only a local storage helper and does not implement that authority. HL-24/26 own settlement evidence and financial slot release. All provider, eligibility and quote-contract activation gates remain explicit.
