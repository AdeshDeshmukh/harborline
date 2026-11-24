import "server-only";
import { sign } from "node:crypto";
import type { GatewayConfig } from "../../server/env";
import { GatewayError } from "./errors";
import { requestJson } from "./transport.server";

export type AccessToken = Readonly<{ accessToken: string; expiresAt: number }>;
export type AuthDependencies = { fetcher?: typeof fetch; now?: () => number };

export function createTokenManager(config: GatewayConfig, deps: AuthDependencies = {}) {
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now;
  let cached: AccessToken | undefined;
  let inFlight: Promise<AccessToken> | undefined;

  async function mint(): Promise<AccessToken> {
    const timestamp = Math.floor(now() / 1000);
    let signature: string;
    try {
      signature = sign("sha256", Buffer.from(`${config.keyId}.${timestamp}`, "utf8"), {
        key: config.privateKey, dsaEncoding: "ieee-p1363",
      }).toString("base64url");
    } catch {
      throw new GatewayError("configuration_error");
    }
    const value = await requestJson("https://api.truemarkets.co/v1/auth/api-key/token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key_id: config.keyId, timestamp, signature }),
    }, fetcher);
    if (!value || typeof value !== "object" || !("access_token" in value) || !("expires_in" in value) ||
      !("token_type" in value) || value.token_type !== "Bearer" ||
      typeof value.access_token !== "string" || !/^[A-Za-z0-9_.-]{1,16384}$/.test(value.access_token) ||
      typeof value.expires_in !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value.expires_in)) {
      throw new GatewayError("malformed_response");
    }
    const expiresAt = Math.min(Date.parse(value.expires_in), now() + 3_600_000);
    if (!Number.isFinite(expiresAt) || expiresAt <= now() + 30_000) throw new GatewayError("malformed_response");
    try {
      const parts = value.access_token.split(".");
      if (parts.length !== 3) throw new Error();
      // This token came directly from the fixed HTTPS authentication endpoint,
      // not a browser. Inspect scope to catch wrong-account/key configuration;
      // decoding is not used to authenticate a user or verify a JWT signature.
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (claims?.tm?.organization_id !== config.organizationId) throw new Error();
    } catch {
      throw new GatewayError("malformed_response");
    }
    cached = Object.freeze({ accessToken: value.access_token, expiresAt });
    return cached;
  }

  return {
    async get(): Promise<AccessToken> {
      if (cached && cached.expiresAt > now() + 30_000) return cached;
      if (!inFlight) inFlight = mint().finally(() => { inFlight = undefined; });
      return inFlight;
    },
    invalidate(token: AccessToken) {
      // A late rejection of an old token must not clear a newer cached token.
      if (cached === token) cached = undefined;
    },
  };
}
