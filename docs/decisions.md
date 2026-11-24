# Feasibility decisions — HL-06

Evidence date: 24 November 2026 (IST). These records refine the existing plan;
they do not authorize deployment, account creation or financial operations.
Source details are in [API contracts](api-contracts.md).

## Decision 1 — Keep Gateway and one explicit DeFi route

Retain the customer-wallet product. Provisionally restrict the pilot to one
Solana spot tokenized-stock listing with USDC settlement; verify the exact
listing in HL-07. Reject smart routing, leverage and cross-chain assumptions.
This simplifies approval and reconciliation, at the cost of market coverage and
possibly execution price. If no supported stock route exists, propose a scope
change explicitly rather than substituting crypto silently.

## Decision 2 — Treat execution as real

The [FAQ](https://docs.truemarkets.co/gateway/faq/) and
[quickstart](https://docs.truemarkets.co/gateway/quickstart/) say there is no
fully working sandbox. OpenAPI nevertheless exposes UAT/paper behavior.
Treat paper access as unavailable until True Markets confirms availability for
this organization. Organizer acceptance of paper evidence is a separate question.
Keep fixtures clearly labeled and disconnected from live credentials.
Cost: end-to-end proof may wait on provider access and a separately authorized
small live experiment. Never run the quickstart as a harmless smoke test: reruns
can buy again.

## Decision 3 — Retain per-user server signers provisionally

[Wallet control](https://docs.truemarkets.co/gateway/wallet-control/) permits
shared server, per-user server, or user-device signers. Keep the plan's per-user
server-key proposal for a controlled builder pilot. This avoids device recovery
work but gives Harborline authority to approve transactions; UI confirmation is
an application policy, not user-exclusive cryptographic custody.

A key per user narrows exposure from one leaked signer, but a full application
compromise can expose access to multiple decrypted keys. Encrypt at rest with
separate secrets and ownership checks; do not claim this prevents server abuse.
Rotation/recovery/exit must be established before funding. Recreating a customer
with another public key does not replace its signer.

## Decision 4 — Fail closed on eligibility and uncertain cash

Do not infer customer eligibility from deployment geography. Do not classify a
trade timeout as failure or release reserved capacity before reconciliation.
These choices reduce convenience but preserve the core promise: stated
commitments must not be spent because an API response was ambiguous.

## Phase 0 answer register

| Plan question | Answer or named blocker | Owner / next evidence | Blocks |
| --- | --- | --- | --- |
| 1. Organization, credentials, pilot authority | **Unverified.** No dashboard or keys inspected. | Adesh: confirm organization exists and access works, without pasting keys into chat. | Authenticated provider proof. |
| 2. End-user geography and onboarding | **Provider guidance pending.** Public docs describe caller geography, not a verified backend method for customer eligibility. | True Markets, coordinated by Adesh: supported location/identity requirements and eligible pilot jurisdiction. | Live enrollment, funding and orders. |
| 3. Paper/UAT access and acceptance | **Unresolved documentation conflict.** No environment tested. | Provider: organization access; organizer: accepted competition evidence. | Any sandbox or accepted-paper claim. |
| 4. Executable stock route, sell-back, maximum debit | **Unproven.** Public contract exists; no quote or trade observed. | HL-07 identifies listing; provider clarifies fee/slippage bound; later authorized pilot verifies. | Signing and protected-cash guarantee for real orders. |
| 5. Signer replacement, recovery and return | **Partly documented.** Transfers exist; signer replacement/loss recovery not established. | Provider guidance; builder recovery rehearsal and authorized exit proof. | Funding and non-builder funds. |
| 6. Submission form | Four artifacts verified publicly; later form requires project creation, intentionally stopped. | HL-05 / Adesh: complete when project creation is authorized. | Final submission completeness claim; not domain work. |
| 7. Fill-to-balance settlement evidence | **Unresolved.** No verified watermark/read-after-finality guarantee. | Provider contract or independently reconciled accounting plus controlled observations. | Automatic release of operation reservation. |

All seven questions are answered to the level of current evidence or explicitly
blocked. **Live feasibility is not established.** Documentation readiness and
operational readiness are separate outcomes.

## Next bounded work

HL-07 may inspect only public catalog and restriction routes, validate failure
handling, and record a candidate listing. No customer provisioning, funding,
order preparation, signing or execution belongs in that step. Pure calculations
and labeled UI fixtures can proceed independently under their own roadmap slices.

No provider/organizer message was sent. Questions above are an unposted request
list. Revisit these decisions when answers arrive; preserve dated evidence rather
than replacing uncertainty with an assumption.
