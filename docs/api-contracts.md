# Gateway contract audit — HL-06

Reviewed 24 November 2026 (IST). This is documentation evidence, not a tested
integration. No authenticated provider requests were made. Pending contracts
block the affected live behavior; they do not block pure domain work.

## Identity and authentication

[Gateway](https://docs.truemarkets.co/gateway/) is the customer-account API;
the Trading API is for the caller's own account. Harborline must resolve its
authenticated user to its provider customer on the server.

[Requests and signing](https://docs.truemarkets.co/gateway/requests-and-signing/)
documents separate organization and transaction keys. Authentication signs
`{key_id}.{timestamp}` using ES256, concatenated r/s and base64url encoding;
clock tolerance is 30 seconds. POST `/v1/auth/api-key/token` returns an hour-long
token without refresh. Customer operations use `TM-On-Behalf-Of`; organization
operations omit it. Wallet signatures use DER/hex inside a base64url stamp.
Never reuse the authentication signature encoder for wallet stamps.

[Customer creation](https://docs.truemarkets.co/gateway/create-a-user/) uses
POST `/v1/account/organizations/{organizationId}/users`, with a stable
`external_ref_id` and compressed P-256 `signer_public_key`. Repeated creation
preserves the original signer; 503/empty wallets require the same request again.
Persist identity and key before provisioning; do not generate a replacement on
retry. Read/list supports recovering the mapping by external reference.

## Assets, location and funding

[Catalog guide](https://docs.truemarkets.co/gateway/what-you-can-trade/): stocks
require `asset_class=stock`; catalog entries identify chain, venue, type and ID.
Select an active DeFi spot stock listing, provisionally on Solana. Exact listing
selection awaits HL-07; prior counts are not current evidence.

[Restrictions](https://docs.truemarkets.co/gateway/geographic-restrictions/)
are dynamic. The page's dynamic table was not rendered in the research response.
[Gateway overview](https://docs.truemarkets.co/gateway/) expressly excludes US
and UK tokenized-stock access. Neither absence from a denylist nor a successful
backend request proves end-user eligibility. Provider guidance is still needed
for backend location handling and onboarding obligations.

[Funding](https://docs.truemarkets.co/gateway/fund-a-wallet/) requires matching
the asset's chain to the user's address. GET `/v1/gateway/balances` returns
`available` tradeable funds; use the matching stablecoin/network row rather than
portfolio USD valuation. The guide says network fees are sponsored. This does
not mean trading fees are zero, or establish post-trade balance finality.

## Preparation, approval and execution

[Order guide](https://docs.truemarkets.co/gateway/place-orders/): create through
POST `/v1/gateway/orders`; size a market buy in quote units, a sell in base
units, using positive decimal strings. Persist the returned ID: unexecuted
orders are absent from the order list but can be read by ID. Execute signed
payloads through POST `/v1/gateway/orders/{id}/execute`; poll the order until a
terminal result. Keep `pending` distinct from `complete`.

[FAQ](https://docs.truemarkets.co/gateway/faq/): a 201 with an empty `order_id`
and quote issues can mean no order was created. A stale quote needs a new order.
Harborline additionally requires fresh user approval; never silently reprice.

The freshly downloaded [OpenAPI](https://docs.truemarkets.co/openapi/gateway.yaml)
reports version **1.56.0**, SHA-256
`bfbbf635338806d30d6b562615b164796c34505c814e01b9e152b3210f76d996`.
Relevant inspected contracts:

- `CreateOrderRequest.venue` defaults to `smart`; explicitly request `defi`.
- Some CeFi routes submit during create. Paper DeFi can also settle during
  create. Do not generalize the guides' signing boundary to every route.
- `UnsignedPayload` requires preserving exact UTF-8 text, including newline;
  its digest is SHA-256. Do not double-hash a digest with a hashing signer.
- `QuoteResponse` describes fees added to buy cost; `QuoteDetails` describes
  input, output and fee but does not establish a contractual maximum debit.
  Do not assume requested quantity alone bounds the wallet debit.
- `QuoteDetails` has no explicit expiry field in this snapshot. A local review
  timeout cannot guarantee provider validity or fixed execution terms.
- Availability is based on request origin; matching restriction rules combine.

The quickstart's approximate quote lifetime is not a service guarantee.
Payload signing, fee bounds and timeout recovery require contract tests and
provider evidence before live use. A mismatch from the expected prepared DeFi
response must halt signing and enter reconciliation, not trigger another order.

## Settlement and exit

[Transaction guide](https://docs.truemarkets.co/gateway/activity/): organization
history omits the customer header and includes each row's `user_id`; user history
requires it. Feed `completed` differs from order `complete`. Preserve raw statuses
and normalize explicitly. Never expose the unfiltered organization feed.

[Go-live checklist](https://docs.truemarkets.co/gateway/go-live/) asks builders to
verify a small buy, sell-back and transaction record. No inspected source
establishes a read-after-fill watermark for balances. Until proven, keep an
uncertain operation reserved and require manual reconciliation; a status word
alone must not release cash for another investment.

[Transfer guide](https://docs.truemarkets.co/gateway/send-funds/) documents
same-chain transfers: create, sign, execute, then read by ID. Confirmed transfers
are irreversible. Documented transfer capability is not a tested exit procedure.
