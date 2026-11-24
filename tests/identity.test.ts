import { expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
import { loadAuthConfig } from "../src/features/identity/config.server";
import { verifySession } from "../src/features/identity/session.server";
import { createAuthHandlers } from "../src/features/identity/handlers.server";

const id = "44444444-4444-4444-8444-444444444444";
const config = { appOrigin: "http://localhost:3000", supabaseUrl: "https://fixture.supabase.co", publishableKey: "sb_publishable_synthetic_fixture_only_123456789" };
const user = { id, email: "builder@example.invalid", email_confirmed_at: "2026-11-24T00:00:00Z", is_anonymous: false };
function port(verified: unknown = user) {
  return { auth: {
    getUser: vi.fn(async () => ({ data: { user: verified }, error: null as unknown })),
    signInWithOtp: vi.fn(async (_args: unknown) => { void _args; return { error: null as unknown }; }),
    exchangeCodeForSession: vi.fn(async (_code: string) => { void _code; return { error: null as unknown }; }),
    signOut: vi.fn(async (_args: unknown) => { void _args; return { error: null as unknown }; }),
  } };
}
function post(path: string, body = "", origin = config.appOrigin) {
  return new NextRequest(`${config.appOrigin}${path}`, { method: "POST", body,
    headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" } });
}

test("authentication remains unavailable in demo or without complete public pilot configuration", () => {
  expect(loadAuthConfig({})).toBeNull();
  expect(loadAuthConfig({ APP_MODE: "pilot" })).toBeNull();
  expect(loadAuthConfig({ APP_MODE: "pilot", NEXT_PUBLIC_APP_URL: config.appOrigin,
    NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishableKey })).toEqual(config);
  expect(loadAuthConfig({ APP_MODE: "pilot", NEXT_PUBLIC_APP_URL: config.appOrigin,
    NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_never_allowed" })).toBeNull();
});

test("only a server-confirmed email identity is accepted, never cookie user fields", async () => {
  await expect(verifySession(port())).resolves.toEqual({ id, email: user.email });
  for (const unverified of [null, { ...user, email_confirmed_at: null }, { ...user, is_anonymous: true }, { ...user, id: "forged" }]) {
    await expect(verifySession(port(unverified))).resolves.toBeNull();
  }
  const denied = port();
  denied.auth.getUser.mockResolvedValue({ data: { user }, error: new Error("private-provider-error") });
  await expect(verifySession(denied)).resolves.toBeNull();
});

test("sign-in is same-origin, invite-only, and uses a fixed-origin PKCE callback", async () => {
  const client = port();
  const handlers = createAuthHandlers({ config: () => config, client: () => client });
  const response = await handlers.start(post("/auth/start", "email=builder%40example.invalid&next=https%3A%2F%2Fevil.invalid"));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/sign-in?status=check-email");
  expect(client.auth.signInWithOtp).toHaveBeenCalledWith({ email: user.email, options: {
    shouldCreateUser: false, emailRedirectTo: "http://localhost:3000/auth/callback?next=%2Faccount",
  } });
  expect(response.headers.get("cache-control")).toContain("no-store");
});

test("cross-site and malformed sign-in posts cannot call the provider", async () => {
  const client = port();
  const handlers = createAuthHandlers({ config: () => config, client: () => client });
  expect((await handlers.start(post("/auth/start", "email=builder%40example.invalid", "https://evil.invalid"))).status).toBe(403);
  expect((await handlers.start(post("/auth/start", "email=not-an-email"))).status).toBe(303);
  const request = new NextRequest(`${config.appOrigin}/auth/start`, { method: "POST", body: "email=a@b.com", headers: { Origin: config.appOrigin, "Content-Type": "application/json" } });
  expect((await handlers.start(request)).status).toBe(415);
  expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
});

test("callback exchanges the code and independently verifies identity before fixed-origin navigation", async () => {
  const client = port();
  const handlers = createAuthHandlers({ config: () => config, client: () => client });
  for (const next of ["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/account%0d%0aLocation:evil"]) {
    const request = new NextRequest(`${config.appOrigin}/auth/callback?code=test-code&next=${encodeURIComponent(next)}`);
    const response = await handlers.callback(request);
    expect(response.headers.get("location")).toBe("http://localhost:3000/account");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  }
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("test-code");
  expect(client.auth.getUser).toHaveBeenCalled();
});

test("missing, failed or unverified callback sessions never reach the account page", async () => {
  const client = port(null);
  const handlers = createAuthHandlers({ config: () => config, client: () => client });
  expect((await handlers.callback(new NextRequest(`${config.appOrigin}/auth/callback`))).headers.get("location"))
    .toBe("/sign-in?status=expired-link");
  expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  expect((await handlers.callback(new NextRequest(`${config.appOrigin}/auth/callback?code=bad`))).headers.get("location"))
    .toBe("/sign-in?status=expired-link");
});

test("sign-out rejects cross-site requests, revokes only this session, and clears chunked auth cookies", async () => {
  const client = port();
  const handlers = createAuthHandlers({ config: () => config, client: () => client });
  expect((await handlers.signOut(post("/auth/sign-out", "", "https://evil.invalid"))).status).toBe(403);
  expect(client.auth.signOut).not.toHaveBeenCalled();
  const request = post("/auth/sign-out");
  request.cookies.set("harborline-auth.0", "private-token");
  request.cookies.set("harborline-auth-code-verifier", "private-verifier");
  request.cookies.set("unrelated", "keep");
  const response = await handlers.signOut(request);
  expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(response.headers.get("location")).toBe("/sign-in?status=signed-out");
  expect(response.cookies.get("harborline-auth.0")?.value).toBe("");
  expect(response.cookies.get("harborline-auth-code-verifier")?.value).toBe("");
  expect(response.cookies.get("unrelated")).toBeUndefined();
});

test("disabled auth never creates a client or sends email", async () => {
  const client = vi.fn(() => port());
  const handlers = createAuthHandlers({ config: () => null, client });
  expect((await handlers.start(post("/auth/start", "email=builder%40example.invalid"))).status).toBe(503);
  expect(client).not.toHaveBeenCalled();
});

test("oversized or duplicate email bodies cannot request a link", async () => {
  const client = port();
  const handlers = createAuthHandlers({ config: () => config, client: () => client });
  expect((await handlers.start(post("/auth/start", `email=${"a".repeat(4097)}`))).status).toBe(415);
  expect((await handlers.start(post("/auth/start", "email=a%40b.com&email=c%40d.com"))).headers.get("location"))
    .toBe("/sign-in?status=invalid-email");
  expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
});

test("provider failure during logout still clears the local session", async () => {
  const client = port();
  client.auth.signOut.mockRejectedValue(new Error("synthetic provider outage"));
  const handlers = createAuthHandlers({ config: () => config, client: () => client });
  const request = post("/auth/sign-out");
  request.cookies.set("harborline-auth", "synthetic-session");
  const response = await handlers.signOut(request);
  expect(response.cookies.get("harborline-auth")?.maxAge).toBe(0);
  expect(response.headers.get("location")).toBe("/sign-in?status=signed-out");
});
