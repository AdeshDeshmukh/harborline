# Customer provisioning — HL-12, simulated integration only

## What can run

This slice implements and tests provisioning with explicit injected dependencies.
It does **not** activate live Gateway provisioning. `POST /api/account/provision`
unconditionally returns `503` with `provisioning_unavailable` and private/no-store
headers. It imports neither the service nor provider credentials. No environment
flag enables it. `/account/setup` requires owner context and explains that setup,
deposits and trading are unavailable; it displays no simulated wallet addresses.

The service, repository and Accounts adapter have no default live composition.
Tests explicitly supply disposable database connections, ephemeral encryption
keys and a simulated provider. The Accounts transport must preserve HTTP status;
the existing generic Gateway client's body-only return value is not sufficient
to distinguish a newly seated signer (`201`) from an existing user (`200`).
Live transport/composition, authorized setup and provider verification are later
reviewed changes, not a toggle to turn on after this merge.

## Components

| Component | Responsibility |
| --- | --- |
| `accounts/key-store.server.ts` | Generate P-256 signers, encrypt/decrypt stored PKCS#8 bytes, derive the public key, and reuse the durable ciphertext. Never returns a private key to the provisioning service. |
| `server/db.ts` | Separate app and signer-role connection factories with the same URL/TLS validation, transaction-local owner context and privileged-role rejection. |
| `truemarkets/accounts.server.ts` | Validate exact customer reference/UUID, wallet shapes and chain families; preserve create status; reject ambiguous lookup results. Transport is explicitly supplied. |
| `accounts/provision-repository.server.ts` | Recheck ownership/current access flags, serialize a local account, bind the original key and persist provisioning state. |
| `accounts/provision.server.ts` | Coordinate lookup/create and return bounded ready/pending/recovery-required/blocked results without exposing upstream errors. |

All modules are server-only. A future handler must obtain `OwnerContext` itself
from the verified session, validate Origin, and never accept owner IDs, provider
IDs, external references or signer material from the browser. The disabled route
has no such mutation path to expose in this slice.

## Durable initialization and concurrency

1. Read and lock the account and profile using the verified context's owner and
   account IDs. Require the stored external reference to match, pilot enabled,
   eligibility `ELIGIBLE`, and no active financial operation. Browser/context flags
   cannot override the current stored flags.
2. Resolve the stored signer using a separate restricted key-store connection.
   Generate only if the account has never started provisioning, has no public key
   or provider identity, and has no encrypted signer. An already stored signer is
   adopted after an interrupted initialization rather than replaced.
3. Commit the original public key and `PROVISIONING` intent before any provider
   request. Private signer persistence has already committed separately.
4. Acquire the account lock again, recheck access/state/key, then perform the
   bounded lookup/create attempt. Concurrent callers re-read the committed result;
   a caller finding `READY` returns it without creating another customer.
5. Persist a validated provider identity and wallet metadata only with a consistent
   reference/identity. Never replace existing provider IDs or differing addresses.

The app uses `FOR NO KEY UPDATE`, which is compatible with the foreign-key KEY
SHARE check when the key-store role inserts a signer. Using `FOR UPDATE` here
could deadlock the app transaction against its own separate key-store transaction.
Lock acquisition is limited to three seconds. Provider calls currently execute
under that row lock; this deliberately avoids introducing a lease/worker schema
for the bounded pilot but occupies a DB connection during the request. A future
live transport needs a strict request budget, cancellation and contention tests
before activation. There is no automatic retry loop in the provisioning service.

## Signer protection and recovery

Each customer has a distinct P-256 signer. PKCS#8 private bytes are encrypted with
AES-256-GCM using an explicitly supplied 32-byte encryption key, random 12-byte
nonce, 16-byte authentication tag and positive key version. Associated data binds
the ciphertext to its local account UUID and key version. Decryption verifies
the tag, key type/curve and the derived compressed public key against the stored
public key. Wrong keys, versions, accounts or modified ciphertext fail closed.

Encryption key rings are supplied explicitly and copied by the store; they are
not read from a committed default, generated as a fallback, or loaded on module
import. Persist and back up encryption keys separately from ciphertext before
any future real provisioning. Removing an old version without migration makes its
records unreadable. Automatic rotation, managed KMS and operational backup/restore
are not implemented. Clearing temporary plaintext buffers is best effort, not a
claim that JavaScript/OpenSSL memory is reliably zeroized.

The app DB login cannot access signer ciphertext. The signer login is a member
only of `harborline_key_store`, cannot read profiles or mutate account mappings,
and uses forced RLS for the requested owner's account. Both connection factories
reject administrative privileges and membership in the opposite role. No signer
login/password is created by a production migration; test logins and synthetic
passwords exist only inside the disposable fixture. No new schema migration is
introduced.

Missing ciphertext for an existing public key, public/private mismatch, unknown
encryption version, or an undecipherable record returns `recovery_required` before
provider access. A private key committed before the app transaction was interrupted
can be reused when that app row still has no public key. It is never overwritten.

## Provider outcomes

| Observation | Treatment |
| --- | --- |
| Fresh `201`, exact reference/identity and both validated wallet families | Local `READY`; this is wallet setup only, not permission to trade. |
| Fresh `201` with incomplete wallets | Persist known mapping, keep `PROVISIONING`, return `pending`. |
| Timeout, `503`, or other uncertain exception | Return `pending`; keep durable reference/key/intent. A later invocation looks up and retries with the same reference/key. |
| Existing fully provisioned user from lookup, or create `200` | Return `recovery_required`; those responses do not report the registered signer. Do not infer signer ownership from matching reference alone. |
| Wrong reference, conflicting provider identity/address, ambiguous lookup or malformed response | Stop and require recovery/review. |
| Existing local `READY` but missing/mismatched signer | Require recovery; do not call the provider or replace the signer. |

If the provider succeeded but the final local commit failed, the next lookup may
find a complete existing user. This intentionally requires operator/provider
verification rather than silently promoting it to ready. No manual override or
automatic signer replacement is included. The provider's supported recovery and
signer-verification procedure remains a live-activation prerequisite.

## Evidence and activation gates

Local tests use real disposable PostgreSQL and real Node cryptography, with
synthetic provider responses. They exercise concurrent setup, durable secret/public
intent before provider access, same-key retries after `503`/empty wallets,
interrupted initialization, ciphertext reuse, identity/key mismatch, missing-key
rejection, role isolation and current owner/access checks. Route tests prove both
demo and pilot modes remain disabled without making a provider request.

Verification on Node 24 passed 93 tests: 6 provider-checker, 59 unit/contract and
28 disposable PostgreSQL tests. Lint, type checking and the credentials-free demo
production build passed. A built-app HTTP check, using the actual SSR SDK with
loopback simulated Auth and disposable PostgreSQL, verified the protected setup
page, POST `503`, GET `405`, private/no-store response and the existing sign-in /
account / sign-out flow. The HTTP request left its synthetic account
`UNPROVISIONED`, with no public signer and no ciphertext row.

Independent review identified two response-validation gaps. Regression tests first
reproduced each, then passed after the fixes: overlapping lookup/create wallet
addresses must agree, and Solana base58 addresses must decode to exactly 32 bytes.
The final 93-test suite includes both regressions. No live provider or hosted
deployment/CI verification was performed in this local slice.

Before live activation, separately establish organization authority, customer
geography/onboarding requirements, registered-signer verification and loss recovery,
encryption-key backup/restore, a status-preserving bounded transport, deployed
role/pooler behavior, and a separately authorized customer-provisioning experiment.
Sandbox access is unverified: the FAQ says no fully working sandbox while the
Accounts reference lists UAT. No user funding, order signing or trading is part of
this slice or authorized by its tests.

## Contract evidence

Reviewed 2026-11-24. Accounts OpenAPI 1.30.0 SHA-256:
`fad8e92094ba970d4b749b240d6a2ed80e1f37e3abdab7c60b05a0a7d5864224`.
Its customer response includes identity/reference/wallets but no registered signer
public key. This is documentation evidence, not authenticated provider proof.

- [User accounts](https://docs.truemarkets.co/gateway/create-a-user/)
- [Wallet control](https://docs.truemarkets.co/gateway/wallet-control/)
- [Accounts specification](https://docs.truemarkets.co/openapi/account.yaml)
- [Gateway FAQ](https://docs.truemarkets.co/gateway/faq/)
- [Existing feasibility gates](decisions.md)
