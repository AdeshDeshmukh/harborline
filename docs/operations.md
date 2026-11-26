# Pilot operations and exit readiness

Status: local preparation only, 26 November 2026. Live customer provisioning,
funding, preparation, approval, execution, settlement release and fund return
have not been enabled or established by this guide. Do not accept outside funds
until supported recovery and exit have been verified. Nothing in this document
is permission to execute a trade, transfer, restore production keys or change a
service's configuration.

## Current controls and limits

| Surface | Current behavior |
| --- | --- |
| Order preparation and approval handlers | Default composition returns unavailable/disabled after the applicable request/session checks; no live service is attached. |
| Fixture signing, execution and maintenance services | Require injected fixture controls; runtime routes do not compose a live financial workflow. |
| `/api/internal/reconcile` | Verifies `CRON_SECRET`, but its default handler has no worker attached and still returns 503. A secret alone does not enable reconciliation. |
| Saved activity and receipts | Owner-scoped local records; manual reload does not run provider recovery or update external balances. |
| HL-28A sale helpers | Pure fixture validation and arithmetic only. `canApprove`, `canExecute` and `canRelease` do not grant authority; applicable result fields are always false. |
| HL-28B disposal UI/API | Saved owner-only sale review/receipt and fictional public examples. POST `/api/disposals/review` returns 503 after valid session/request checks; no live service or transfer endpoint. See [lifecycle](disposal-lifecycle.md). |
| `TRADING_ENABLED`, `SETTLEMENT_AUTO_RELEASE` | Proposed entries in `.env.example`, not implemented runtime kill switches. Changing them is not a verified way to stop a future deployed service. |
| `APP_MODE=pilot` and credentials | May permit the existing local database/auth/client primitives to initialize. They do not attach a reviewed live trading workflow. |

Before any later live deployment, document and test the actual write-disable
mechanism in that deployment: which preparation, approval, send and scheduled
entry points it blocks, how in-flight operations are preserved, and how a read-only
investigation continues. Test the send boundary after a delayed commit/signing
step. Do not describe an environment flag as a kill switch until enforced.

## Who may do what

The customer owns the account and approves the exact action. An operator may
assist, explain a blocked state and inspect authorized records. Operator access
must come from a server-established allowlist or equivalent reviewed identity;
it does not turn an operator into the customer's owner context.

Future composition must independently verify the signed-in owner, owned provider
mapping, supported listing/network, customer eligibility, operator permission
where required, and exact approved terms. Never accept these as trusted request
fields. HL-28B fixture repositories require an independent injected trusted
operator allowlist; no HTTP composition authenticates an operator or enables
a sale. HL-28A itself has no authenticated workflow or operator allowlist; its normalized
bindings and `contract_fixture` labels are data contracts, not access controls.

Creating a new review, approving it, executing a sale and returning funds are
separate decisions. Approval of a code change, a login or an API-key setup grants
none of those financial permissions.

## If an order is uncertain

1. Preserve the original intent, request key/hash, review generation, provider
   order ID, approval, dispatch claim and existing observations. Do not log
   payload text, signatures, keys or raw credential-bearing errors.
2. Keep the account's shared operation reservation. A timeout, browser close or
   terminal status word alone cannot release it. Never reset state or clear the
   slot manually to make a button work.
3. Stop further writes using the reviewed deployment control, once one exists.
   Do not retry create/execute under another key, venue or customer. DeFi create
   can affect allocations even before signed execution; “unsigned” is not a
   universal no-effects guarantee.
4. With separate authorized provider access, inspect the original customer-bound
   order and relevant activity/balances. A missing provider ID or an orphaned
   dispatch requires an explicit investigation; it is not evidence of failure.
5. Preserve conflicting reports. A partial failed/canceled order may already
   have moved assets. Do not replace actual quantities with the old quote.
6. Use only a reviewed reconciliation/clearance workflow with exact evidence
   links and independent stock and cash accounting. Current maintenance stores
   support fixture buys. The separate HL-28B fixture clearance requires original
   approval, dispatch/send authorization, completed send callback, latest terminal
   order evidence and matching fresh stock/cash proof in one atomic transaction.
   Pausing new writes permits authorized read investigation and recording
   already-issued callbacks; it does not grant clearance or resend. The pure HL-28A helper cannot
   release a reservation or persist a verification.
7. Inform the account owner of what is known, what remains unknown and the next
   read-only check. Sanitize shared records; do not send secrets or post private
   customer activity in an issue or PR.

## Signer backup and recovery requirements

Preserve the encrypted signer record, its account binding, nonce/tag and key
version, plus the corresponding encryption-key version through a separately
protected backup process. Include registered public-key mappings and the local
review-vault key/version where applicable. An encrypted database backup without
its required keys is not a demonstrated recovery procedure. Do not export or
paste plaintext keys into logs, chat, source control, test fixtures or runbooks.

Before a real deposit, rehearse recovery in an explicitly authorized isolated
environment with fictional material first. Restore the same account-bound
record and required key versions; verify that the derived public key exactly
matches the existing registered signer. The existing local signer primitive
rejects mismatched account/key/public-key bindings. That local check is not proof
that a restored signer can access a funded provider wallet.

Do not generate a replacement signer and assume it controls an existing wallet.
Do not recreate a provider customer to bypass a lost signer. No inspected primary
source establishes Harborline's signer-loss replacement procedure. If the signer
or its necessary encryption key cannot be recovered, keep writes blocked and
obtain provider-supported instructions through an authorized channel. Do not
promise that funds are recoverable until the supported procedure is demonstrated.

## Suspected credential or signer compromise

Use the reviewed deployment write-disable mechanism and preserve investigation
evidence. A future incident procedure must cover both organization authentication
and customer signing authority; rotation of one key is not a complete recovery
claim. The provider documents revoking organization API keys in its dashboard,
but already-issued tokens can remain valid until they expire within an hour.
Revocation therefore must not be described as immediate invalidation of every
issued token. Coordinate the exact response with authorized account owners and
provider guidance. Do not perform a production rotation or secret restore from
this guide without specific authorization.

## Controlled sell-back rehearsal (future, separately authorized)

Before execution, record a sanitized approval envelope covering the owner and
account, stock listing/network, exact base quantity, available base holdings,
quote currency, fee asset/treatment, bounded terms, expiry and the money at risk.
The server must bind fresh owned holdings and exact payload digests to the review;
operator assistance does not replace explicit customer approval.

A zero buying allowance does not prevent a sale. The maximum base debit is bounded
by available owned stock units, not by a USD valuation or cash spending budget.
An expired or altered review needs a new review and approval. No automatic venue
fallback, leverage, short sale or sale of held/unavailable units is in scope.

After a separately approved send, read the original order and establish actual
filled/unfilled base units, actual gross quote proceeds and fee. Then independently
reconcile stock leaving and quote cash arriving, including unrelated movements.
Require durable dispatch completion and all ownership/chronology/conflict checks
in the later persisted workflow. Record receipt links and result, including any
partial failure. A successful buy or a fixture test is not evidence that this
sell-back path works live.

## Fund return procedure: documented capability, unverified operation

The official guide documents same-chain transfer creation, signing, execution
and reading by ID. HL-28A deliberately implements no transfer helper or endpoint.
Do not run the guide's sample amounts or addresses as an operational instruction.

Before a real return, establish the provider-supported procedure and approve:

- The exact owner/provider wallet, asset listing/mint, network, available amount,
  fee and maximum total debit. Sales proceeds must already be independently
  reconciled; uncertain balance data is insufficient.
- The exact destination address and authorization to receive funds there. Syntax
  validation or matching a network alone does not prove ownership or permission.
  Verify the full address through the owner's approved channel; never copy a
  documentation example, transaction-history address or untrusted message.
- Exact prepared transfer terms and payloads matched to that approved destination,
  asset/network and amount. Any changed destination or terms invalidates approval.
- The approved small rehearsal and who performs the final financial confirmation.
  A separate transfer implementation must have its own reviewed destination-bound
  contract and tests; it may require another PR.

Persist the original transfer ID before the send boundary. If the result is
uncertain, read that same transfer rather than creating a replacement. Record
actual sent/received quantities, fees, final status, safe transaction reference and
post-transfer balances only when independently established. A confirmed on-chain
transfer is irreversible; a local status screen cannot reverse it.

Do not treat the return path as verified until the supported procedure has been
rehearsed with explicitly approved funds and its complete evidence recorded. The
live-return and signer-recovery gates remain open work for controlled integration.

## Evidence checklist before outside funds

All of these remain unverified for live operation:

- Supported jurisdiction/customer eligibility and owned account/wallet mapping.
- Actual deployment write-disable and incident controls, including in-flight work.
- Backup/restore of the existing registered signer with provider-supported recovery.
- A separately approved small buy and base-sized sell-back with actual results.
- Independent stock/cash reconciliation, durable receipts and no unresolved effects.
- Authorized exact-destination return and observed final result/balances.

Record sanitized evidence in [integration proof](evidence/integration-proof.md).
Never replace missing evidence with a green unit test, a dashboard screenshot of
an unrelated account or a statement that credentials have been configured.

## Sources inspected 26 November 2026

- [Place orders](https://docs.truemarkets.co/gateway/place-orders/) and
  [create-order reference](https://docs.truemarkets.co/api/gateway/create-order/).
- [Send funds](https://docs.truemarkets.co/gateway/send-funds/).
- [Wallet control](https://docs.truemarkets.co/gateway/wallet-control/).
- [Go-live checklist](https://docs.truemarkets.co/gateway/go-live/).

Source code for the current boundaries: approval-handlers.server.ts,
worker-handler.server.ts, execute.server.ts, accounts/signer.server.ts and the
fixture-only disposal contracts. Guides describe provider capabilities; they do
not establish Harborline's deployed controls or authorize actions.
