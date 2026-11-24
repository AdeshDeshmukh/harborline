export type GatewayErrorCode =
  | "configuration_error" | "gateway_disabled" | "invalid_request"
  | "network_error" | "http_error" | "malformed_response" | "unknown_outcome";

const messages: Record<GatewayErrorCode, string> = {
  configuration_error: "Gateway configuration is invalid or incomplete",
  gateway_disabled: "Gateway access is disabled in demo mode",
  invalid_request: "Gateway request is invalid",
  network_error: "Gateway request timed out or could not reach the provider",
  http_error: "Gateway provider rejected the request",
  malformed_response: "Gateway provider returned an invalid response",
  unknown_outcome: "Gateway operation outcome is unknown; reconcile before another attempt",
};

// Deliberately excludes raw bodies, tokens, paths, key material and error causes.
export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly status?: number;
  readonly requestId?: string;
  readonly retryAfterMs?: number;

  constructor(code: GatewayErrorCode, status?: number, requestId?: string, retryAfterMs?: number) {
    super(messages[code]);
    this.name = "GatewayError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.retryAfterMs = retryAfterMs;
  }
}
