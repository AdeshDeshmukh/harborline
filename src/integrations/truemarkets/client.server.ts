import "server-only";
import { isUuid, loadGatewayConfig, type GatewayConfig } from "../../server/env";
import { createTokenManager, type AuthDependencies } from "./auth.server";
import { GatewayError } from "./errors";
import { requestJson } from "./transport.server";

type Dependencies = AuthDependencies & { sleep?: (ms: number) => Promise<void>; random?: () => number };
type Options = { userId?: string; body?: unknown };
const origin = "https://api.truemarkets.co";

export function createGatewayClient(config: GatewayConfig, deps: Dependencies = {}) {
  const tokens = createTokenManager(config, deps);
  const fetcher = deps.fetcher ?? fetch;
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;

  return {
    async request(method: "GET" | "POST", path: string, options: Options = {}): Promise<unknown> {
      let url: URL;
      let body: string | undefined;
      try {
        url = new URL(path, origin);
        if (!["GET", "POST"].includes(method) || !/^\/v1\/(gateway|account)\//.test(path) ||
          /[\\#\r\n]/.test(path) || url.origin !== origin || url.pathname !== path.split("?")[0] ||
          (options.userId !== undefined && !isUuid(options.userId)) ||
          (method === "GET" && options.body !== undefined)) throw new Error();
        body = options.body === undefined ? undefined : JSON.stringify(options.body);
      } catch {
        throw new GatewayError("invalid_request");
      }
      let renewed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const token = await tokens.get();
        const headers: Record<string, string> = { Authorization: `Bearer ${token.accessToken}` };
        if (options.userId) headers["TM-On-Behalf-Of"] = options.userId;
        if (body !== undefined) headers["Content-Type"] = "application/json";
        try {
          return await requestJson(url.href, { method, headers, body }, fetcher);
        } catch (error) {
          if (!(error instanceof GatewayError)) throw new GatewayError("network_error");
          // Evict a rejected token even if this operation must not retry, or its
          // read budget is exhausted. The next independent call can mint anew.
          if (error.status === 401) tokens.invalidate(token);
          if (method !== "GET") {
            if (error.code === "network_error" || error.code === "malformed_response" || (error.status ?? 0) >= 500) {
              throw new GatewayError("unknown_outcome", error.status, error.requestId);
            }
            throw error;
          }
          if (attempt === 2) throw error;
          if (error.status === 401 && !renewed) {
            renewed = true;
            continue;
          }
          const retryable = error.code === "network_error" || error.status === 429 || (error.status ?? 0) >= 500;
          if (!retryable) throw error;
          const backoff = (attempt === 0 ? 500 : 1500) * (1 + random() * 0.25);
          const wait = Math.max(backoff, error.status === 429 ? error.retryAfterMs ?? 0 : 0);
          if (wait > 60_000) throw error; // Do not clamp a long reset and retry too early.
          await sleep(wait);
        }
      }
      throw new GatewayError("network_error");
    },
  };
}

let singleton: ReturnType<typeof createGatewayClient> | undefined;

// Lazy: importing this module does not require live configuration or make calls.
export function getGatewayClient() {
  if (!singleton) {
    const settings = loadGatewayConfig();
    if (settings.mode !== "pilot") throw new GatewayError("gateway_disabled");
    singleton = createGatewayClient(settings.config);
  }
  return singleton;
}
