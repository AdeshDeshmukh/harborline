# Authentication (HL-10)

Harborline uses Supabase Auth email links with PKCE. This slice establishes a
server-verified identity and local sign-out. It does not bootstrap database
accounts itself, provision Gateway customers, establish investment eligibility, or
enable financial actions. The account page now calls the separate
[HL-11 ownership boundary](account-ownership.md) for local account bootstrap.

## Configuration and setup

The default `APP_MODE=demo` keeps sign-in unavailable and needs no credentials.
Pilot authentication requires all of the following in the server environment:

- `APP_MODE=pilot`
- `NEXT_PUBLIC_APP_URL`: the exact application origin, with HTTPS outside loopback.
- `NEXT_PUBLIC_SUPABASE_URL`: the project's Supabase origin.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the public `sb_publishable_...` key.
  A legacy anon JWT in `NEXT_PUBLIC_SUPABASE_ANON_KEY` is a fallback.

Never use a secret/service-role key for these values. Missing or invalid
configuration leaves authentication unavailable. Auth configuration is independent
of the Gateway client: setting pilot mode does not call Gateway or create an account.

Before a deployed pilot test, a project administrator must:

1. Configure Supabase Site URL to the canonical application origin and explicitly
   allow the corresponding `/auth/callback` redirect, including the application's
   `next=/account` query. Use exact environment-specific entries; avoid production
   wildcard redirects. A deliberate return to `/` also needs an allowed entry.
2. Enable email authentication, disable public signups, and pre-create approved
   Auth users through an administrator-controlled process. The application sends
   `shouldCreateUser: false`; sign-in never registers new users.
3. Keep the email link's `{{ .ConfirmationURL }}` flow so Supabase verifies the
   link and returns a PKCE `code` to this callback. This application does not
   implement a `token_hash` verification endpoint. Check any customized template
   against this flow rather than copying a different callback pattern.
4. Configure email delivery and provider rate/abuse controls appropriate to the
   pilot. This slice has no application-level distributed rate limiter or CAPTCHA.
5. Restart the application after changing configuration. Test on the same origin,
   in the same browser that requested the email, because the verifier cookie binds
   the callback to that browser. Use a new link if it expires or is consumed.

Configuration changes, user invitations, and sending actual email require a
separate authorized setup/test; none are performed by the automated tests.

## Request flow and trust boundaries

| Surface | Behavior |
| --- | --- |
| `GET /sign-in` | Dynamic server page; verified users go to `/account`. Unconfigured demo shows a disabled form. |
| `POST /auth/start` | Requires the exact configured Origin and a URL-encoded body limited to 4 KiB; requests an email link for an existing user. |
| `GET /auth/callback` | Exchanges one bounded code using the browser's PKCE verifier, then calls `getUser()` before choosing a success redirect. |
| `GET /account` | Independently verifies the user on the server; missing or invalid identity redirects to `/sign-in`. |
| `POST /auth/sign-out` | Requires the exact Origin, requests local session revocation, and clears this browser's auth cookies even on provider failure. No GET logout exists. |

Only `/account` and `/` are allowed return paths, always on the configured origin.
Incoming Host/forwarded headers and arbitrary `next` URLs cannot select a success
redirect. Errors use fixed messages rather than echoing tokens or provider errors.
Sign-in responses do not reveal whether an email exists; provider-returned errors
use the same check-email message. Transport failure may show unavailability.

Each request creates its own Supabase client. Identity comes from the Auth server's
`getUser()` response, with a confirmed email, non-anonymous status and a valid UUID;
cookie-embedded user fields are never authorization evidence. Missing, expired,
malformed or provider-rejected sessions fail closed.

## Cookies, cache and session lifecycle

- Cookies use a host-only `harborline-auth` name (with SDK chunking), `Path=/`,
  `HttpOnly`, and `SameSite=Lax`; HTTPS origins additionally use `Secure`.
- There is no browser Supabase client. Server-only session management permits
  HttpOnly cookies; adding a browser client later requires revisiting this choice.
- Proxy refreshes cookies for `/sign-in` and `/account/*`. It forwards refreshed
  cookies to the downstream render and returns them to the browser. It is not the
  authorization boundary; protected pages still verify identity independently.
- Auth responses and protected pages must not be publicly cached. Adapters retain
  SDK cache-prevention headers; Auth fetches use `no-store`, disallow redirects and
  have an eight-second per-request timeout.
- Local sign-out affects this browser's session rather than all devices. On a
  provider outage, local cookies are still cleared, but remote revocation cannot
  be guaranteed. Existing access JWTs elsewhere may remain valid until expiry.
- No tokens, authorization codes, email addresses or raw provider errors are
  deliberately logged by this implementation. Hosting/access-log retention and
  query-string redaction still need review before a real pilot.

## Decisions and trade-offs

| Decision | Reason and cost |
| --- | --- |
| Provider-confirmed `getUser()` on protected requests | Rejects a forged cookie identity and checks current provider state; costs network latency and makes protected pages unavailable during an Auth outage. Proxy and rendering may each verify. |
| Cookie-bound PKCE email links | Avoids storing a password and binds code exchange to the requester; switching browsers, clearing cookies, or opening a link on another device breaks that flow. |
| Invite-only entry | Keeps pilot enrollment deliberate; user invitation and investment eligibility remain separate administrative/product flows. |
| Dynamic server pages and POST forms | Small client surface and usable without client-side auth state; no browser-side automatic token refresh or optimistic account UI. |
| Strict canonical Origin on POST | Prevents cross-site login/logout requests; preview/proxy origins must be explicitly configured to match the user's origin. |

## Validation and remaining evidence

Tests exercise handlers, refresh propagation and the installed Supabase SSR SDK
using synthetic identities and an in-memory simulated Auth endpoint. They cover
PKCE challenge/verifier binding, provider verification, forged and expired
sessions, bounded redirects, CSRF rejection, disabled configuration and local
logout. Database tests exercise the existing persistence boundary separately;
HL-10 tests identity in isolation; HL-11 separately tests its ownership boundary
and local account bootstrap against disposable PostgreSQL.

Local production-preview checks confirm that an unsigned visitor to `/account`
returns to `/sign-in` and demo mode exposes a disabled sign-in form. These checks
are not evidence of real email delivery or a deployed Supabase session.

A local HTTP smoke check also exercised the built Next.js app and actual SSR SDK
against a loopback simulated Auth service: signed-out redirect, PKCE exchange,
protected page reload, signed-in redirect, local logout, then denied account
access. This used synthetic data and no external provider. The focused automated
suite has 15 identity tests; the full regression suite has 57 tests including
the disposable PostgreSQL checks. Lint, type checking and a credentials-free demo
production build are separate verification gates.

Independent review found no blocking issues. A successful expired-token refresh
through the actual SDK and Proxy together remains useful additional coverage;
current tests cover the SDK's expired-session failure and Proxy cookie forwarding
separately. Request a fresh email link after starting a second sign-in flow;
multiple outstanding links in one browser are not a supported workflow here.

**Still required before claiming deployed authentication works:** configure a
dedicated Supabase environment, receive a real invited-user email, complete the
callback on the deployed origin, reload and verify the authenticated page, sign
out and verify access is removed, and test expiry/invalid links and provider-side
delivery controls. No real Supabase project credentials were available during
this implementation; that acceptance evidence remains pending.

## References

Checked 2026-11-24; pinned implementations: `@supabase/ssr` 0.12.7 and
`@supabase/supabase-js` 2.119.2. Next.js cookie/Proxy conventions were checked
against the installed Next.js 16.4.6 documentation in `node_modules/next/dist/docs/`.

- [Supabase server-side client setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Supabase passwordless email sign-in](https://supabase.com/docs/guides/auth/auth-email-passwordless)
