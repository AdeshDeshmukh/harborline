import "server-only";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getVerifiedSession } from "../identity/session.server";
import { requireOwnerContext, OwnerAccessError, type OwnerContext } from "../identity/access.server";
import { ReadContractError, type ReadCode } from "../../integrations/truemarkets/read-types";

type Service = { assets(context: OwnerContext): Promise<unknown>; balance(context: OwnerContext): Promise<unknown> };
type Options = { owner?: typeof requireOwnerContext; session?: typeof getVerifiedSession; service?: () => Service };
export function createMarketReadHandlers(options: Options = {}) {
  const owner = options.owner ?? requireOwnerContext;
  // No env switch, org client, private read, or live eligibility composition yet.
  const service = options.service ?? (() => { throw new ReadContractError("integration_unverified"); });
  async function run(kind: keyof Service, request: NextRequest) {
    try {
      if (new URL(request.url).search) throw new ReadContractError("invalid_request");
      if (!options.service) {
        // Disabled reads verify identity without inserting a local profile/account.
        const identity = options.owner ? await owner() : await (options.session ?? getVerifiedSession)();
        if (!identity) throw new OwnerAccessError("unauthenticated");
        throw new ReadContractError("integration_unverified");
      }
      const context = await owner();
      return json(await service()[kind](context), 200);
    } catch (error) {
      if (error instanceof OwnerAccessError && error.code === "unauthenticated") return json({ code: "unauthenticated", message: "Sign-in is required", recoverable: false, requestId: randomUUID() }, 401);
      const failure = error instanceof ReadContractError ? error : new ReadContractError("unavailable");
      const statuses: Record<ReadCode, number> = { invalid_response: 503, unsupported_route: 409, restricted: 403, eligibility_unverified: 403,
        wrong_owner: 403, account_not_ready: 409, stale_evidence: 409, unavailable: 503, integration_unverified: 503, invalid_request: 400 };
      return json({ code: failure.code, message: failure.message, recoverable: ["stale_evidence", "unavailable"].includes(failure.code), requestId: randomUUID() }, statuses[failure.code]);
    }
  }
  return { assets: (request: NextRequest) => run("assets", request), balance: (request: NextRequest) => run("balance", request) };
}
function json(value: unknown, status: number) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", Expires: "0" } }); }
export const marketReadHandlers = createMarketReadHandlers();
