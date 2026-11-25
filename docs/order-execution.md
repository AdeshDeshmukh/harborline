# Fixture signing and single execution — HL-24

## Authority

HL-24 adds server-side wallet stamping, owned durable dispatch, an injected
fixture execution adapter/service, and POST `/api/investments/[id]/approve`.
The exported runtime route remains hard disabled after request/session checks:
it cannot initialize an account, database, vault, signer or Gateway client.
Authenticated valid requests receive 503; anonymous valid requests receive 401.
There is no environment switch enabling this route. Existing UI authority flags
remain false and there is no enabled approval button.

Only an explicitly injected fixture composition can exercise the full service.
The execution repository requires both `fixtureMode` and
`fixtureExecutionEnabled`; the adapter and service reject provider mode.
HL-23's separate fixture approval controls must also permit a new approval.
These switches do not establish live pilot authority. Tests generate disposable
P-256 keys; no real customer signer, provider mutation or funds are used.

Eligibility/location, verified quote asset and maximum-debit/expiry guarantees,
registered-signer recovery and the return path remain live-activation gates.
Public signing documentation resolves encoding, not those financial guarantees.

## Exact signing contract

The [Gateway signing guide](https://docs.truemarkets.co/gateway/requests-and-signing/)
requires wallet payloads to be signed as their exact UTF-8 text, including
trailing newlines, using P-256/SHA-256. Each stamp is unpadded base64url of JSON
containing the compressed public key, DER signature in hex and scheme
`SIGNATURE_SCHEME_TK_API_P256`. Stamp order must match payload order.
Organization authentication instead uses the P1363 `r || s` representation;
its encoder must not be reused for wallet signing. The payload digest is already
SHA-256; passing it to a SHA-256 signing function would hash the wrong bytes.

`accounts/signer.server.ts` validates ordered payload digests, authenticates the
stored AES-GCM envelope with account/version AAD, verifies the expected public
key and signs the original bytes. The owned signer reads existing ciphertext
with the separate signer-role database. It never creates a replacement key,
exports a private key to the caller or returns ciphertext. Wrong owner, key,
version, authentication tag or digest cannot produce a stamp.

The low-level stamping primitive is not approval authority. Routes must use the
owned approval/execution composition rather than accept signing payloads from
a browser. Decrypted byte buffers are cleared in `finally`; JavaScript strings
and native key objects do not offer guaranteed complete memory erasure.

## Durable dispatch and ownership

HL-23's execution attempt persists before its fixture callback. A receipt's
`accepted` flag is data, not a capability to resend that attempt. HL-24 therefore
adds a second, unique durable dispatch claim before decryption/signing.

Migration `0007_execution_dispatch.sql` adds append-only `execution_dispatches`:
one row per attempt, bound to the attempt/intent/account composite identity,
with forced owner RLS and SELECT/INSERT-only application grants. Public/signer
roles have no access. The new unique identity on `execution_attempts` is added
before its dependent foreign key. Published migrations/snapshots are unchanged.

Under the owned account update lock, the repository validates the exact approved
review revision/hash, owner/external reference, active operation, `SUBMITTING`
state, possible-effects fence, preparation generation, source, provider mapping,
asset/quantity, calculation, current policy/timezone/local date and selected cash
observation. Current commitments/buffer recompute the reviewed cash explanation.
The approval balance must remain latest, not future and at most 15 seconds old;
the exclusive review deadline must not have arrived.

Controls and time-sensitive checks run after prerequisite reads/locks. Claim,
redacted audit and ownership constraints commit together. A failed insert/audit
rolls back the dispatch. An exact repeated internal execution call observes the
existing claim and never decrypts, signs or sends again, including after a crash
between claim and send. That conservative crash window remains held for recovery.

## Handoff and outcome

The service opens the owned encrypted review with its bound hash/AAD, checks the
ordered payload digest list against immutable approved terms, and asks the owned
signer to stamp it. After the awaited signer operation it takes the account lock
again and repeats current controls, date, expiry, cash/plan and provider mapping
checks. A mapping change cannot redirect previously signed payloads. Since that
transaction still awaits commit, it also returns a server-only synchronous
freshness assertion. After validating and constructing the execute request, the
adapter invokes this assertion immediately before the injected transport call,
with no intervening await. It rechecks current controls, exclusive review expiry,
inclusive 15-second cash freshness, clock reversal and the captured local date.
Commit or event-loop delays cannot preserve an earlier time window. No database
transaction is held across stamping or the injected transport call.

The fixture adapter makes one call to its injected transport's
`POST /v1/gateway/orders/{id}/execute`, using the owned provider user ID and only
`auth_type: api_key` plus ordered stamps. It has no default transport and no retry
loop. The injected transport must also avoid mutation retries; the existing
Gateway client already does so. This establishes one local dispatch claim, not
an exactly-once guarantee for an external system.

Only bounded statuses are persisted: `complete`, `pending`, `failed`, `canceled`
map to matching local states; malformed/unexpected responses and exceptions
become `UNKNOWN`. The raw response, keys, stamps, payloads and exception text are
not persisted in the audit or returned in HTTP DTOs. A successful status does
not supply fill quantities, fees, settlement evidence or a receipt by assumption.

Outcome state and its redacted audit commit together. Recording uncertainty
does not require execution to remain enabled. If persistence fails, the existing
claim and possible-effects fence remain; the approval service attempts its
conservative uncertainty fallback, otherwise returns bounded unavailable.
Neither failure nor replay releases the account slot or creates another send.

The [order guide](https://docs.truemarkets.co/gateway/place-orders/) directs
already-submitted execute responses to a read rather than another execute.
Timeouts and all execution errors are handled conservatively here. HL-25 owns
read-only recovery; HL-26 owns evidence-based settlement and slot release.
Even local `COMPLETE` retains account serialization. No automatic re-prepare,
retry, timeout unlock or success-to-settlement inference is included.

## HTTP boundary and UI

The route binds intent ID from the path and accepts exactly `reviewRevision`,
`termsHash`, and `acknowledged: true`. It rejects query parameters, extra keys,
cross-origin requests, non-JSON input and bodies over 4096 bytes. Owner/account,
cash bounds, payloads, keys, stamps and enable flags cannot come from the body.
Responses use private/no-store headers and explicitly project safe receipt
fields; future service metadata cannot automatically become browser data.

The default handler only checks the verified session before returning disabled.
Injected service dependencies are for tests and are not runtime activation.
No user-interface component gains execution authority in this slice.

## Verification and limits

Local tests exercise exact-byte DER verification, Unicode/newline sensitivity,
no digest double-hash, key/envelope/digest mismatches, signer-role ownership,
20-way approval and direct-executor concurrency, owned immutable dispatch/FK,
current-input changes, corrupt payloads, audit rollback, lost/malformed responses,
expiry or disabled controls during signing, crash-without-send replay, held
terminal/unknown states, and disabled HTTP/session/body/privacy behavior.
Migration inventory checks now expect seven migrations and thirteen forced-RLS
tables while retaining their record-preservation assertions.

These are local cryptographic, injected transport, HTTP handler and disposable
PostgreSQL checks. Final-boundary regressions await real repository authorization,
then advance the clock or disable execution before returning to the adapter;
expiry, stale cash, local-date rollover and disabled controls cause no send,
while an exactly 15-second-old observation is accepted. A signer-role SELECT
denial assertion was also checked against an intentionally granted permission
in the disposable test, then passed with the migration's permissions restored.

These checks do not prove deployed permissions, live provider
acceptance, actual process-crash durability, authenticated browser approval,
financial settlement, recovery or end-user eligibility. Those remain explicit
later work and activation prerequisites.

After the review fix pass, the local full suite passed 498 tests: six offline
provider-script tests, 310 unit/contract tests and 182 disposable PostgreSQL
tests. ESLint and the production build passed on Node 24.22.3. The independent
review was not rerun after fixes; regression tests establish the addressed
timing gap and signer-role assertion. No live financial proof is claimed.
