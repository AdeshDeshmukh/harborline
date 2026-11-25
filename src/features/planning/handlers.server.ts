import "server-only";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireOwnerContext, OwnerAccessError } from "../identity/access.server";
import { loadAuthConfig } from "../identity/config.server";
import { createPlanningService } from "./service.server";
import { createPlanningRepository } from "./repository.server";
import { PlanningStoreError, type PlanningStoreCode } from "./storage-errors";
import { PlanningValidationError } from "./errors";

type Dependencies = { origin?: () => string | null; owner?: typeof requireOwnerContext; service?: () => ReturnType<typeof createPlanningService> };
export function createPlanningHandlers(deps: Dependencies = {}) {
  const origin = deps.origin ?? (() => loadAuthConfig()?.appOrigin ?? null), owner = deps.owner ?? requireOwnerContext;
  const service = deps.service ?? (() => createPlanningService(createPlanningRepository()));
  async function run(kind: keyof ReturnType<typeof createPlanningService>, request: NextRequest) {
    const requestId = randomUUID();
    try {
      const canonicalOrigin = origin();
      if (!canonicalOrigin) throw new PlanningStoreError("unavailable");
      if (kind !== "get" && request.headers.get("origin") !== canonicalOrigin) throw new HttpError(403, "invalid_origin", "Request origin is not allowed");
      const input = kind === "get" ? undefined : await jsonBody(request);
      const context = await owner(), api = service();
      const result = kind === "get" ? await api.get(context) : await api[kind](context, input);
      return json(result, kind === "createCommitment" ? 201 : 200);
    } catch (error) {
      if (error instanceof HttpError) return json({ code: error.code, message: error.message, requestId, recoverable: false }, error.status);
      if (error instanceof PlanningValidationError) return json({ code: error.code, message: error.message, requestId, recoverable: false }, 400);
      if (error instanceof OwnerAccessError && error.code === "unauthenticated") return json({ code: "unauthenticated", message: "Sign-in is required", requestId, recoverable: false }, 401);
      const failure = error instanceof PlanningStoreError ? error : new PlanningStoreError("unavailable");
      const status: Record<PlanningStoreCode, number> = { invalid_request: 400, conflict: 409, not_found: 404, plan_required: 409, operation_in_progress: 409, unavailable: 503 };
      return json({ code: failure.code, message: failure.message, requestId, recoverable: status[failure.code] === 409 || status[failure.code] === 503 }, status[failure.code]);
    }
  }
  return {
    get: (request: NextRequest) => run("get", request),
    savePolicy: (request: NextRequest) => run("savePolicy", request),
    createCommitment: (request: NextRequest) => run("createCommitment", request),
    updateCommitment: (request: NextRequest) => run("updateCommitment", request),
    removeCommitment: (request: NextRequest) => run("removeCommitment", request),
  };
}
export const planningHandlers = createPlanningHandlers();

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", Expires: "0" } });
}
class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
async function jsonBody(request: NextRequest): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new HttpError(415, "invalid_content_type", "Send a JSON request body");
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let length = 0;
  if (reader) {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > 8192) { await reader.cancel().catch(() => {}); throw new HttpError(413, "body_too_large", "Planning request is too large"); }
      chunks.push(part.value);
    }
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new HttpError(400, "invalid_json", "Send a valid JSON request body"); }
}
