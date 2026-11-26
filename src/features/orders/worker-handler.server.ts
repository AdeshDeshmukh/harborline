import "server-only";
import { timingSafeEqual } from "node:crypto";
type Summary = {
  claimed: number;
  completed: number;
  failed: number;
  timedOut: boolean;
};
export function createReconciliationHandler(options: {
  secret: () => string | undefined;
  run?: () => Promise<Summary>;
}) {
  const response = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET")
      return response(405, { error: "method_not_allowed" });
    try {
      const secret = options.secret();
      if (!secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret))
        return response(503, { error: "reconciliation_unavailable" });
      const expected = Buffer.from("Bearer " + secret), actual = Buffer.from(request.headers.get("authorization") ?? "");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        return response(401, { error: "unauthorized" });
      if (new URL(request.url).search || request.body !== null)
        return response(400, { error: "invalid_request" });
      if (!options.run)
        return response(503, { error: "reconciliation_unavailable" });
      const result = await options.run();
      if (![result.claimed, result.completed, result.failed].every(n => Number.isSafeInteger(n) && n >= 0) || result.claimed > 10 || typeof result.timedOut !== "boolean")
        throw new Error();
      return response(200, { source: "contract_fixture", summary: { claimed: result.claimed, completed: result.completed, failed: result.failed, timedOut: result.timedOut } });
    }
    catch {
      return response(503, { error: "reconciliation_unavailable" });
    }
  };
}
// Secret verification is necessary but does not enable private runtime access.
export const reconciliationHandler = createReconciliationHandler({ secret: () => process.env.CRON_SECRET });
