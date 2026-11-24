# Server Gateway client — HL-08

## Scope and use

This is a server-side transport and organization-authentication foundation, not
a customer enrollment or trading feature. No app route currently invokes it.
`getGatewayClient()` lazily validates configuration and returns the process-local
client; it makes no network request until `request()` is called. Provider calls
return `unknown`; consuming adapters must validate endpoint-specific schemas.

Configuration defaults to `APP_MODE=demo`, which needs no credentials. Calling
the live-client getter in that mode throws `gateway_disabled`; the static sample
can still build and render. `APP_MODE=pilot` requires:

- `TRUE_MARKETS_ORGANIZATION_ID`: organization UUID.
- `TRUE_MARKETS_API_KEY_ID`: organization API key UUID.
- `TRUE_MARKETS_API_PRIVATE_KEY`: JSON-encoded P-256 private JWK, not a wallet
  signer or a complete downloaded key-file wrapper.

Keep values in server secrets; never paste keys into chat, logs, fixtures, or
public environment variables. Configuration is loaded only on server demand.
Restart the process after configuration changes. No new secret is supplied or
used in this implementation's tests.

## Ownership and authority

The `userId` option sets `TM-On-Behalf-Of`. It does **not** prove that the current
Harborline user owns that provider account. Later authenticated adapters must
resolve the account mapping server-side and enforce eligibility and authorization
before calling the client. Never pass an untrusted browser-supplied provider ID
directly into this transport. Organization-scoped calls omit `userId`.

All credential-bearing modules import `server-only`. The client fixes the origin
to `https://api.truemarkets.co`, accepts only `/v1/gateway/` and `/v1/account/`
paths, rejects normalized traversal and redirects, and sends no cookies. There
is no configurable host override or browser transport.

## Authentication and lifecycle

Organization authentication uses Node crypto: the exact UTF-8
`{key_id}.{Unix seconds}` challenge, SHA-256/P-256, concatenated r/s bytes and
base64url encoding. The token response's `expires_in` is an absolute timestamp,
not a seconds duration. The client renews 30 seconds early and caps cache lifetime
at one hour. Concurrent calls share an in-flight mint in each client instance.
The lazy application getter shares one instance per process; serverless instances
do not coordinate tokens across processes.

The token comes directly from the fixed provider HTTPS endpoint. Its decoded
`tm.organization_id` must match configured organization identity to catch a
wrong-account/key setup. This is a scope consistency check, not JWT-signature
verification or authentication of a browser token. Tokens are never accepted
from the browser. Mint failures are not cached or automatically retried.

## Retry and uncertainty rules

Every attempt has an 8-second timeout, including reading a successful JSON body,
and uses `cache: no-store`. GET requests have at most three resource attempts:

- Network failures, 429, and 5xx may retry with jittered 0.5s/1.5s backoff.
- A 429 respects `X-RateLimit-Reset` seconds, including an empty error body.
  A wait above 60 seconds stops instead of retrying before the reset.
- A 401 may invalidate the rejected token and mint once. Repeated 401s stop;
  missing customer headers or configuration may still require correction.
- Other status errors and malformed successful JSON stop immediately.

POST requests are single-attempt, including on 401/429/5xx. Network loss, 5xx or
an unreadable successful POST response becomes `unknown_outcome`. Later domain
code must reconcile by durable operation identity before another attempt. This
client provides no order idempotency, no mutation recovery or signing policy,
and no automatic execution. Endpoint-specific safe retries need their own proof.

Every 401 evicts its rejected cached token, including a POST or a final GET
attempt. This prepares the next independent call to authenticate again; it does
not replay the failed mutation or extend the current read retry budget.

Errors expose only fixed local codes/messages, status, a locally generated UUID
sent as `X-Request-Id`, and numeric reset metadata. Provider bodies, messages,
arbitrary error codes, returned request IDs and nested causes are excluded.
Future trading adapters will need explicitly validated provider-specific error
codes; this foundation does not yet distinguish `quote_stale` from other 422s.
Successful endpoint data is server-private and must not be logged or returned
to a browser wholesale.

## Verification and limits

`pnpm test` runs the public checker tests plus Vitest server contracts.
`pnpm test:gateway` runs only the latter. Tests use generated, disposable local
keys and simulated HTTP responses; no real authentication call is made.
The `server-only` marker is mocked solely within the Node unit test file.
An actual Next.js build with a temporary Client Component importing the server
configuration is used separately to verify compiler rejection; the probe is
removed before the normal production build.

The static sample build without Gateway credentials, lint, typechecking, and the
offline test suite must pass before handoff. Provider-account access, real token
acceptance, customer eligibility, signer recovery, debit bounds and deployment
verification remain the gates documented in [decisions](decisions.md).

Sources reviewed 24 November 2026:
[Gateway signing](https://docs.truemarkets.co/gateway/requests-and-signing/),
[authentication](https://docs.truemarkets.co/developer-resources/authentication/),
[errors](https://docs.truemarkets.co/developer-resources/errors/), and
[rate limits](https://docs.truemarkets.co/developer-resources/rate-limits/).
