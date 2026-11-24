import "server-only";
import { createPrivateKey, type KeyObject } from "node:crypto";
import { GatewayError } from "../integrations/truemarkets/errors";

export type GatewayConfig = Readonly<{
  organizationId: string;
  keyId: string;
  privateKey: KeyObject;
}>;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export function loadGatewayConfig(env: Record<string, string | undefined> = process.env):
  { mode: "demo" } | { mode: "pilot"; config: GatewayConfig } {
  const mode = env.APP_MODE ?? "demo";
  if (mode === "demo") return { mode };
  if (mode !== "pilot" || !isUuid(env.TRUE_MARKETS_ORGANIZATION_ID) || !isUuid(env.TRUE_MARKETS_API_KEY_ID)) {
    throw new GatewayError("configuration_error");
  }
  try {
    const jwk = JSON.parse(env.TRUE_MARKETS_API_PRIVATE_KEY ?? "");
    if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" ||
      ![jwk.x, jwk.y, jwk.d].every(value => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value))) {
      throw new Error();
    }
    const privateKey = createPrivateKey({ key: jwk, format: "jwk" });
    if (privateKey.type !== "private" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error();
    return { mode, config: Object.freeze({
      organizationId: env.TRUE_MARKETS_ORGANIZATION_ID,
      keyId: env.TRUE_MARKETS_API_KEY_ID,
      privateKey,
    }) };
  } catch {
    throw new GatewayError("configuration_error");
  }
}
