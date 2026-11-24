import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";

// Runtime marker is mocked only inside Node unit tests. Next.js enforces the
// actual client-import boundary; a separate build check verifies that boundary.
vi.mock("server-only", () => ({}));

import { loadGatewayConfig } from "../src/server/env";
import { createTokenManager } from "../src/integrations/truemarkets/auth.server";
import { createGatewayClient, getGatewayClient } from "../src/integrations/truemarkets/client.server";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const keyId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const time = Date.parse("2026-11-24T06:00:00Z");
const config = { organizationId, keyId, privateKey };
const tokenString = (label = "token-one", org = organizationId) =>
  `${Buffer.from('{"alg":"ES256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ tm: { organization_id: org }, jti: label })).toString("base64url")}.synthetic-signature`;
const tokenResponse = (token = "token-one", now = time) => Response.json({
  access_token: tokenString(token), token_type: "Bearer", expires_in: new Date(now + 3_600_000).toISOString(),
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

test("missing pilot configuration leaves demo available without reading credentials", () => {
  expect(loadGatewayConfig({})).toEqual({ mode: "demo" });
  expect(loadGatewayConfig({ APP_MODE: "demo", TRUE_MARKETS_API_PRIVATE_KEY: "bad-secret" })).toEqual({ mode: "demo" });
});

test("the lazy application client refuses live access in demo mode", () => {
  vi.stubEnv("APP_MODE", "demo");
  expect(() => getGatewayClient()).toThrow("Gateway access is disabled in demo mode");
});

test("pilot configuration validates all IDs and a P-256 private JWK with safe errors", () => {
  const env = {
    APP_MODE: "pilot", TRUE_MARKETS_ORGANIZATION_ID: organizationId,
    TRUE_MARKETS_API_KEY_ID: keyId,
    TRUE_MARKETS_API_PRIVATE_KEY: JSON.stringify(privateKey.export({ format: "jwk" })),
  };
  expect(loadGatewayConfig(env).mode).toBe("pilot");
  for (const bad of [{ APP_MODE: "invalid" }, { ...env, TRUE_MARKETS_API_KEY_ID: "secret-invalid" },
    { ...env, TRUE_MARKETS_API_PRIVATE_KEY: "secret-invalid" },
    { ...env, TRUE_MARKETS_API_PRIVATE_KEY: JSON.stringify(publicKey.export({ format: "jwk" })) }]) {
    expect(() => loadGatewayConfig(bad)).toThrow(/configuration/i);
    try { loadGatewayConfig(bad); } catch (error) { expect(String(error)).not.toContain("secret-invalid"); }
  }
});

test("organization authentication signs the exact key-id and Unix-second challenge with P1363 ES256", async () => {
  const fetcher: typeof fetch = async (url, init) => {
    expect(url).toBe("https://api.truemarkets.co/v1/auth/api-key/token");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
    const body = JSON.parse(init?.body as string);
    expect(body.key_id).toBe(keyId);
    expect(body.timestamp).toBe(1795500000);
    const signature = Buffer.from(body.signature, "base64url");
    expect(signature.length).toBe(64);
    expect(verify("sha256", Buffer.from("11111111-1111-4111-8111-111111111111.1795500000"),
      { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)).toBe(true);
    return tokenResponse();
  };
  const manager = createTokenManager(config, { fetcher, now: () => time });
  expect((await manager.get()).accessToken).toBe(tokenString());
});

test("concurrent requests share a mint and renew before the absolute expiry", async () => {
  let now = time;
  let mints = 0;
  const manager = createTokenManager(config, { now: () => now, fetcher: async () => tokenResponse(`token-${++mints}`, now) });
  expect((await Promise.all([manager.get(), manager.get(), manager.get()])).map(t => t.accessToken))
    .toEqual([tokenString("token-1"), tokenString("token-1"), tokenString("token-1")]);
  now += 3_570_001;
  expect((await manager.get()).accessToken).toBe(tokenString("token-2"));
  expect(mints).toBe(2);
});

test("failed or malformed token responses are redacted, not cached, and not retried automatically", async () => {
  for (const response of [new Response("secret-server-error", { status: 503 }),
    Response.json({ access_token: "secret-token", expires_in: 3600 }),
    Response.json({ access_token: "secret-token", token_type: "Bearer", expires_in: "2000-01-01T00:00:00Z" }),
    new Response("secret-bad-json")]) {
    let calls = 0;
    const manager = createTokenManager(config, { now: () => time, fetcher: async () => { calls++; return response.clone(); } });
    await expect(manager.get()).rejects.toMatchObject({ name: "GatewayError" });
    await manager.get().catch(error => expect(JSON.stringify(error)).not.toContain("secret"));
    expect(calls).toBe(2);
  }
});

test("authenticated reads attach the supplied provider-user header and no-store without forwarding caller headers", async () => {
  const client = createGatewayClient(config, { now: () => time, fetcher: async (url, init) => {
    if (String(url).endsWith("/token")) return tokenResponse();
    expect(url).toBe("https://api.truemarkets.co/v1/gateway/balances");
    expect(init?.method).toBe("GET");
    expect(init?.cache).toBe("no-store");
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${tokenString()}`);
    expect(headers.get("TM-On-Behalf-Of")).toBe(userId);
    return Response.json({ data: [] });
  } });
  await expect(client.request("GET", "/v1/gateway/balances", { userId })).resolves.toEqual({ data: [] });
});

test("a token for a different organization is rejected before any customer read", async () => {
  let reads = 0;
  const client = createGatewayClient(config, { now: () => time, fetcher: async url => {
    if (!String(url).endsWith("/token")) { reads++; return Response.json({}); }
    return Response.json({ access_token: tokenString("other", userId), token_type: "Bearer",
      expires_in: new Date(time + 3_600_000).toISOString() });
  } });
  await expect(client.request("GET", "/v1/gateway/balances")).rejects.toMatchObject({ code: "malformed_response" });
  expect(reads).toBe(0);
});

test("late invalidation of an old token preserves the newly minted token", async () => {
  let now = time; let mints = 0;
  const manager = createTokenManager(config, { now: () => now, fetcher: async () => tokenResponse(`token-${++mints}`, now) });
  const old = await manager.get();
  now += 3_570_001;
  const current = await manager.get();
  manager.invalidate(old);
  expect(await manager.get()).toBe(current);
  expect(mints).toBe(2);
});

test("read retries honor empty-body rate limits and stop after three attempts", async () => {
  const waits: number[] = [];
  let reads = 0;
  const client = createGatewayClient(config, { now: () => time, random: () => 0,
    sleep: async ms => { waits.push(ms); }, fetcher: async url => {
      if (String(url).endsWith("/token")) return tokenResponse();
      reads++;
      return reads === 1 ? new Response(null, { status: 429, headers: { "X-RateLimit-Reset": "2" } })
        : new Response("private-error", { status: 503 });
    } });
  await expect(client.request("GET", "/v1/gateway/balances", { userId })).rejects.toMatchObject({ status: 503 });
  expect(reads).toBe(3);
  expect(waits).toEqual([2000, 1500]);
});

test("a rate reset beyond the retry budget fails without retrying early", async () => {
  let reads = 0;
  const client = createGatewayClient(config, { now: () => time, sleep: async () => { throw Error("must not wait"); },
    fetcher: async url => {
      if (String(url).endsWith("/token")) return tokenResponse();
      reads++;
      return new Response(null, { status: 429, headers: { "X-RateLimit-Reset": "120" } });
    } });
  await expect(client.request("GET", "/v1/gateway/balances")).rejects.toMatchObject({ status: 429 });
  expect(reads).toBe(1);
});

test("a rejected read token is replaced once; repeated 401 does not loop", async () => {
  let mints = 0; let reads = 0;
  const client = createGatewayClient(config, { now: () => time, fetcher: async url => {
    if (String(url).endsWith("/token")) return tokenResponse(`token-${++mints}`);
    reads++;
    return new Response("private-denial", { status: 401 });
  } });
  await expect(client.request("GET", "/v1/gateway/balances", { userId })).rejects.toMatchObject({ status: 401 });
  expect(mints).toBe(2); expect(reads).toBe(2);
});

test("mutations are attempted once even on 401, 429, 5xx or network loss", async () => {
  for (const status of [401, 429, 503, 0]) {
    let posts = 0;
    const client = createGatewayClient(config, { now: () => time, fetcher: async url => {
      if (String(url).endsWith("/token")) return tokenResponse();
      posts++;
      if (!status) throw new Error("secret-network-message");
      return new Response("secret-body", { status });
    } });
    await expect(client.request("POST", "/v1/gateway/quotes", { userId, body: { qty: "2" } }))
      .rejects.toMatchObject({ name: "GatewayError", code: status === 0 || status >= 500 ? "unknown_outcome" : "http_error" });
    expect(posts).toBe(1);
  }
});

test("POST 401 invalidates the token for the next independent call without replaying this POST", async () => {
  let mints = 0; let posts = 0;
  const client = createGatewayClient(config, { now: () => time, fetcher: async (url, init) => {
    if (String(url).endsWith("/token")) return tokenResponse(`token-${++mints}`);
    posts++;
    return new Headers(init?.headers).get("Authorization") === `Bearer ${tokenString("token-2")}`
      ? Response.json({ accepted: true }) : new Response(null, { status: 401 });
  } });
  await expect(client.request("POST", "/v1/gateway/quotes")).rejects.toMatchObject({ status: 401 });
  expect(posts).toBe(1);
  await expect(client.request("POST", "/v1/gateway/quotes")).resolves.toEqual({ accepted: true });
  expect(mints).toBe(2); expect(posts).toBe(2);
});

test("401 on the final GET attempt also evicts the rejected token", async () => {
  let mints = 0; let reads = 0;
  const client = createGatewayClient(config, { now: () => time, sleep: async () => {}, fetcher: async (url, init) => {
    if (String(url).endsWith("/token")) return tokenResponse(`token-${++mints}`);
    reads++;
    if (reads < 3) return new Response(null, { status: 503 });
    return new Headers(init?.headers).get("Authorization") === `Bearer ${tokenString("token-2")}`
      ? Response.json({ recovered: true }) : new Response(null, { status: 401 });
  } });
  await expect(client.request("GET", "/v1/gateway/balances")).rejects.toMatchObject({ status: 401 });
  expect(reads).toBe(3);
  await expect(client.request("GET", "/v1/gateway/balances")).resolves.toEqual({ recovered: true });
  expect(mints).toBe(2); expect(reads).toBe(4);
});

test("concurrent callers share a deferred renewal after the cached token ages out", async () => {
  let now = time; let mints = 0;
  const renewal = Promise.withResolvers<Response>();
  const manager = createTokenManager(config, { now: () => now, fetcher: async () => {
    mints++;
    return mints === 1 ? tokenResponse("first") : renewal.promise;
  } });
  await manager.get();
  now += 3_570_001;
  const pending = [manager.get(), manager.get(), manager.get()];
  expect(mints).toBe(2);
  renewal.resolve(tokenResponse("renewed", now));
  expect((await Promise.all(pending)).map(t => t.accessToken))
    .toEqual([tokenString("renewed"), tokenString("renewed"), tokenString("renewed")]);
  expect(mints).toBe(2);
});

test.each(["GET", "POST"] as const)("%s timeout also covers stalled JSON after successful headers", async method => {
  vi.useFakeTimers();
  let calls = 0;
  const client = createGatewayClient(config, { now: () => time, sleep: async () => {}, fetcher: async (url, init) => {
    if (String(url).endsWith("/token")) return tokenResponse();
    calls++;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"data":'));
      init?.signal?.addEventListener("abort", () => controller.error(new Error("private-body-timeout")), { once: true });
    } }));
  } });
  const result = client.request(method, "/v1/gateway/quotes").catch(error => error);
  await vi.advanceTimersByTimeAsync(method === "GET" ? 24_001 : 8_001);
  const error = await result;
  expect(error).toMatchObject({ code: method === "GET" ? "network_error" : "unknown_outcome" });
  expect(JSON.stringify(error)).not.toContain("private-body-timeout");
  expect(calls).toBe(method === "GET" ? 3 : 1);
});

test("malformed successful POST JSON reports unknown outcome without replay", async () => {
  let posts = 0;
  const client = createGatewayClient(config, { now: () => time, fetcher: async url => {
    if (String(url).endsWith("/token")) return tokenResponse();
    posts++;
    return new Response("private-broken-json");
  } });
  await expect(client.request("POST", "/v1/gateway/quotes")).rejects.toMatchObject({ code: "unknown_outcome" });
  expect(posts).toBe(1);
});

test("invalid routes and user IDs fail before authentication, preventing credential forwarding", async () => {
  const client = createGatewayClient(config, { fetcher: async () => { throw Error("must not fetch"); } });
  for (const path of ["https://evil.invalid/", "//evil.invalid/", "/v1/gateway/../../auth", "/v1/gateway/\\evil", "/v1/gateway/assets#fragment"]) {
    await expect(client.request("GET", path)).rejects.toMatchObject({ code: "invalid_request" });
  }
  await expect(client.request("GET", "/v1/gateway/balances", { userId: "secret-invalid" })).rejects.toMatchObject({ code: "invalid_request" });
});

test("upstream errors and malformed success JSON expose neither body nor arbitrary provider fields", async () => {
  for (const response of [new Response("secret-html", { status: 403 }),
    Response.json({ message: "secret", request_id: "secret", code: "secret", metadata: { key: "secret" } }, { status: 422 }),
    new Response("secret-json")]) {
    const client = createGatewayClient(config, { now: () => time, fetcher: async url =>
      String(url).endsWith("/token") ? tokenResponse() : response.clone() });
    try { await client.request("GET", "/v1/gateway/balances"); expect.fail("must reject"); }
    catch (error) {
      expect(error).toMatchObject({ name: "GatewayError" });
      expect(String(error)).not.toContain("secret");
      expect(JSON.stringify(error)).not.toContain("secret");
    }
  }
});

test("a stalled read is aborted at eight seconds and exhausts its bounded retry count", async () => {
  vi.useFakeTimers();
  let reads = 0;
  const client = createGatewayClient(config, { now: () => time, sleep: async () => {}, fetcher: async (url, init) => {
    if (String(url).endsWith("/token")) return tokenResponse();
    reads++;
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("secret-timeout")), { once: true }));
  } });
  const result = client.request("GET", "/v1/gateway/balances").catch(error => error);
  await vi.advanceTimersByTimeAsync(24_001);
  expect(await result).toMatchObject({ code: "network_error" });
  expect(reads).toBe(3);
});
