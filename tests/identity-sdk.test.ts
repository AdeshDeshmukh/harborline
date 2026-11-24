import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import type { CookieMethodsServer, CookieOptions } from "@supabase/ssr";
vi.mock("server-only", () => ({}));
import { createAuthClient } from "../src/features/identity/supabase.server";
import { verifySession } from "../src/features/identity/session.server";

const config = { appOrigin: "https://app.example.invalid", supabaseUrl: "https://fixture.supabase.co", publishableKey: "sb_publishable_synthetic_fixture_only_123456789" };
const user = { id: "44444444-4444-4444-8444-444444444444", aud: "authenticated", role: "authenticated",
  email: "builder@example.invalid", email_confirmed_at: "2026-11-24T00:00:00Z", is_anonymous: false, app_metadata: {}, user_metadata: {}, created_at: "2026-11-24T00:00:00Z" };
const jwt = (exp = Math.floor(Date.now() / 1000) + 3600) =>
  `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, aud: "authenticated", exp })).toString("base64url")}.synthetic-signature`;

function jar() {
  const values = new Map<string, string>();
  const writes: CookieOptions[] = [];
  const adapter: CookieMethodsServer = {
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
    setAll: (cookies, headers) => {
      expect(headers["Cache-Control"] ?? "no-store").toContain("no-store");
      for (const { name, value, options } of cookies) {
        if (options.maxAge === 0) values.delete(name); else values.set(name, value);
        writes.push(options);
      }
    },
  };
  return { values, writes, adapter };
}

test("real SSR SDK performs cookie-bound PKCE, verifies through the user endpoint, and removes the session on sign-out", async () => {
  const cookies = jar();
  const accessToken = jwt();
  let challenge = ""; let exchanges = 0; let logouts = 0;
  const fetcher: typeof fetch = async (url, init) => {
    const target = new URL(String(url));
    expect(target.origin).toBe("https://fixture.supabase.co");
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("error");
    if (target.pathname === "/auth/v1/otp") {
      const body = JSON.parse(init?.body as string);
      expect(body.create_user).toBe(false);
      expect(body.code_challenge_method).toBe("s256");
      challenge = body.code_challenge;
      return Response.json({});
    }
    if (target.pathname === "/auth/v1/token") {
      expect(target.searchParams.get("grant_type")).toBe("pkce");
      const body = JSON.parse(init?.body as string);
      expect(body.auth_code).toBe("fixture-code");
      expect(createHash("sha256").update(body.code_verifier).digest("base64url")).toBe(challenge);
      exchanges++;
      return Response.json({ access_token: accessToken, refresh_token: "synthetic-refresh", expires_in: 3600, token_type: "bearer", user });
    }
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${accessToken}`);
    if (target.pathname === "/auth/v1/user") return Response.json(user);
    expect(target.pathname).toBe("/auth/v1/logout");
    expect(target.searchParams.get("scope")).toBe("local");
    logouts++;
    return new Response(null, { status: 204 });
  };
  const client = createAuthClient(config, cookies.adapter, fetcher);
  await client.auth.signInWithOtp({ email: user.email, options: { shouldCreateUser: false, emailRedirectTo: `${config.appOrigin}/auth/callback` } });
  expect(cookies.values.has("harborline-auth-code-verifier")).toBe(true);
  expect((await client.auth.exchangeCodeForSession("fixture-code")).error).toBeNull();
  expect(exchanges).toBe(1);
  const nextRequestClient = createAuthClient(config, cookies.adapter, fetcher);
  expect(await verifySession(nextRequestClient)).toEqual({ id: user.id, email: user.email });
  expect(cookies.writes.every(options => options.httpOnly === true && options.secure === true && options.sameSite === "lax")).toBe(true);
  await nextRequestClient.auth.signOut({ scope: "local" });
  expect(logouts).toBe(1);
  expect(await verifySession(createAuthClient(config, cookies.adapter, fetcher))).toBeNull();
});

test("real SSR SDK rejects a forged cookie identity when the provider denies its access token", async () => {
  const cookies = jar();
  cookies.values.set("harborline-auth", `base64-${Buffer.from(JSON.stringify({
    access_token: jwt(), refresh_token: "forged-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { ...user, email: "forged@example.invalid" },
  })).toString("base64url")}`);
  let checks = 0;
  const client = createAuthClient(config, cookies.adapter, async url => {
    expect(new URL(String(url)).pathname).toBe("/auth/v1/user"); checks++;
    return Response.json({ message: "synthetic denial", code: "bad_jwt" }, { status: 401 });
  });
  expect(await verifySession(client)).toBeNull();
  expect(checks).toBe(1);
});

test("missing and expired sessions fail closed with the actual SDK", async () => {
  const missing = createAuthClient(config, jar().adapter, async () => { throw Error("must not contact provider without a session"); });
  expect(await verifySession(missing)).toBeNull();
  const cookies = jar();
  cookies.values.set("harborline-auth", `base64-${Buffer.from(JSON.stringify({ access_token: jwt(1),
    refresh_token: "expired-refresh", expires_at: 1, user })).toString("base64url")}`);
  const expired = createAuthClient(config, cookies.adapter, async () =>
    Response.json({ message: "expired", code: "refresh_token_not_found" }, { status: 400 }));
  expect(await verifySession(expired)).toBeNull();
});

test("PKCE callback without the originating browser verifier cannot exchange a code", async () => {
  const fetcher = vi.fn(async () => { throw new Error("must not exchange without a verifier"); });
  const client = createAuthClient(config, jar().adapter, fetcher);
  expect((await client.auth.exchangeCodeForSession("synthetic-code")).error).not.toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
