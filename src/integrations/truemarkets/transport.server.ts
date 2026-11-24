import "server-only";
import { randomUUID } from "node:crypto";
import { GatewayError } from "./errors";

export async function requestJson(url: string, init: RequestInit, fetcher: typeof fetch): Promise<unknown> {
  const requestId = randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set("X-Request-Id", requestId);
      response = await fetcher(url, {
        ...init, headers, signal: controller.signal,
        redirect: "error", credentials: "omit", cache: "no-store",
      });
    } catch {
      throw new GatewayError("network_error", undefined, requestId);
    }
    if (!response.ok) {
      const reset = response.headers.get("X-RateLimit-Reset");
      const seconds = reset !== null && /^\d+(?:\.\d+)?$/.test(reset) ? Number(reset) : undefined;
      // Never propagate a provider-supplied message, request ID or metadata.
      void response.body?.cancel().catch(() => {});
      throw new GatewayError("http_error", response.status, requestId,
        seconds !== undefined && Number.isFinite(seconds) ? seconds * 1000 : undefined);
    }
    try {
      return await response.json();
    } catch {
      throw new GatewayError(controller.signal.aborted ? "network_error" : "malformed_response", undefined, requestId);
    }
  } finally {
    clearTimeout(timeout);
  }
}
