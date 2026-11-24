# Public Gateway route check — HL-07

## Run locally

Use the project's Node 24 toolchain and locked dependencies:

```sh
pnpm test:provider
pnpm verify:provider 0016331d-4c93-4dcd-87d5-12e0ff36f931
```

The argument is the exact candidate asset ID, not a ticker search. No environment
file, API key, signer, wallet or account is required. The script sends only GETs
to the hard-coded production public catalog and restriction endpoints. It refuses
redirects, sets a 10-second timeout per request, and emits no upstream error body
or exception details. A failure exits nonzero; it does not retry or save a result.
Successful JSON is written to stdout; saving it is an explicit shell action.

Tests use synthetic responses and run offline in CI. They cover matching-rule
union, ambiguous/missing/unusable candidates, malformed/partial responses,
unrecognized selectors and values, invalid IDs and sanitized request failures.
They are contract tests for this checker, not tests of provider execution.

## Observation

Recorded **24 November 2026, 05:40:25 UTC / 11:10:25 IST**, from the local machine.
See the [sanitized observation](evidence/hl-07-public-read.json).

The [filtered catalog](https://api.truemarkets.co/v1/gateway/assets?asset_class=stock&venue=defi&product_type=spot)
returned 2,066 rows and a null next cursor. Candidate:

| Field | Observed value |
| --- | --- |
| Symbol / provider name | SPYX / SP500 |
| Asset ID | `0016331d-4c93-4dcd-87d5-12e0ff36f931` |
| Mint | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` |
| Chain / venue / type | Solana / DeFi / spot |
| Class / status | stock / active |
| Tradeable / order types | true / market |
| Quote currency | Not exposed by this observation; unverified |

SPYX is a technical candidate for the planned route, not an investment
recommendation or an approved asset choice. These are provider catalog labels,
not independently verified underlying holdings, liquidity or redemption rights.

The [restriction endpoint](https://api.truemarkets.co/v1/gateway/assets/restrictions)
returned three rules. Its stock rule applied to this candidate and listed 69
country codes, including US and GB. All matching rules are combined. There is no
country eligibility verdict: absence from those rules does not establish lawful
use, onboarding approval or a supported backend geography method.

## Decisions and limits

- Keep this executable separate from the Next.js request path; it creates no
  application route and requires no new runtime dependency.
- Use the exact listing ID and validate returned fields locally, even when the
  request filters should already select them. Refuse partial pagination and
  unfamiliar restriction rules rather than interpreting them as permission.
  Cost: schema additions may require an explicit checker update.
- Keep dated public metadata in the evidence file. It is not a runtime allowlist
  and must be refreshed before a later pilot.
- This run was **local**, not in the intended deployment environment. Deployment
  region is still undecided pending provider guidance. Repeat this check there
  once an environment is authorized; backend success still will not prove user
  eligibility.
- No availability endpoint, private data, balances, quotes, order preparation,
  signatures, transfers or financial operations were used.

Local public-route evidence is established. Deployment-origin verification and
the live gates in [HL-06 decisions](decisions.md) remain pending. Neither this
script nor the fixtures may be described as proof of a funded/executable route.
