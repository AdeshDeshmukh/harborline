import { expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
import { createPlanningHandlers } from "../src/features/planning/handlers.server";
import { createPlanningService } from "../src/features/planning/service.server";
import { OwnerAccessError, type OwnerContext } from "../src/features/identity/access.server";
import { PlanningStoreError } from "../src/features/planning/storage-errors";
import type { PlanView, PlanningRepository } from "../src/features/planning/storage-types";

const origin = "http://localhost:3000", id = "66666666-6666-4666-8666-666666666666";
const context = { ownerId: "44444444-4444-4444-8444-444444444444", accountId: "55555555-5555-4555-8555-555555555555" } as OwnerContext;
const view: PlanView = { revision: 2, policy: { horizonDays: 30, additionalBuffer: "500", acknowledgedAt: "2026-11-24T00:00:00.000Z", revision: 2 }, commitments: [] };
function request(method: string, body?: unknown, source = origin, contentType = "application/json") {
  return new NextRequest(`${origin}/api/plan`, { method, headers: { Origin: source, "Content-Type": contentType },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
}
function setup() {
  const repository: PlanningRepository = { get: vi.fn(async () => view), mutate: vi.fn(async () => view) };
  const owner = vi.fn(async () => context), service = vi.fn(() => createPlanningService(repository));
  return { repository, owner, service, handlers: createPlanningHandlers({ origin: () => origin, owner, service }) };
}

test("GET returns the verified owner's plan with private/no-store headers", async () => {
  const { handlers, repository } = setup(); const response = await handlers.get(request("GET"));
  expect(response.status).toBe(200); expect(await response.json()).toEqual(view);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(repository.get).toHaveBeenCalledWith(context);
});

test("missing authentication and disabled configuration cannot access planning storage", async () => {
  const { repository, service } = setup();
  const denied = createPlanningHandlers({ origin: () => origin, owner: async () => { throw new OwnerAccessError("unauthenticated"); }, service });
  expect((await denied.get(request("GET"))).status).toBe(401);
  const disabled = createPlanningHandlers({ origin: () => null, service });
  expect((await disabled.get(request("GET"))).status).toBe(503);
  expect(repository.get).not.toHaveBeenCalled(); expect(service).not.toHaveBeenCalled();
});

test("all mutation methods reject cross-site or missing Origin before authentication or storage", async () => {
  const { handlers, owner, service } = setup();
  for (const handler of [handlers.savePolicy, handlers.createCommitment, handlers.updateCommitment, handlers.removeCommitment]) {
    for (const source of ["https://evil.invalid", ""]) expect((await handler(request("POST", {}, source))).status).toBe(403);
  }
  expect(owner).not.toHaveBeenCalled(); expect(service).not.toHaveBeenCalled();
});

test("policy and commitment HTTP commands preserve validated values and server ownership", async () => {
  const { handlers, repository } = setup();
  expect((await handlers.savePolicy(request("PUT", { expectedRevision: 1, horizonDays: 30, additionalBuffer: "500.00", acknowledged: true }))).status).toBe(200);
  expect((await handlers.createCommitment(request("POST", { expectedRevision: 2, label: "Rent", amount: "1200.50", dueDate: "2026-12-01" }))).status).toBe(201);
  expect((await handlers.updateCommitment(request("PATCH", { expectedRevision: 3, id, status: "paid" }))).status).toBe(200);
  expect((await handlers.removeCommitment(request("DELETE", { expectedRevision: 4, id }))).status).toBe(200);
  expect(vi.mocked(repository.mutate).mock.calls.every(([owner]) => owner === context)).toBe(true);
  expect(repository.mutate).toHaveBeenCalledWith(context, { kind: "create", expectedRevision: 2, label: "Rent", amount: "1200.5", dueDate: "2026-12-01" });
});

test("bad media, malformed/oversized JSON and caller-owned identity fields cannot mutate storage", async () => {
  const { handlers, repository } = setup();
  expect((await handlers.savePolicy(request("PUT", "{}", origin, "text/plain"))).status).toBe(415);
  expect((await handlers.savePolicy(request("PUT", "{"))).status).toBe(400);
  expect((await handlers.savePolicy(request("PUT", "x".repeat(8193)))).status).toBe(413);
  expect((await handlers.createCommitment(request("POST", { expectedRevision: 2, label: "Rent", amount: "1", dueDate: "2026-12-01", accountId: "attacker" }))).status).toBe(400);
  expect(repository.mutate).not.toHaveBeenCalled();
});

test("revision conflicts are recoverable 409 responses with a server-generated request ID", async () => {
  const { repository, handlers } = setup(); vi.mocked(repository.mutate).mockRejectedValue(new PlanningStoreError("conflict"));
  const response = await handlers.removeCommitment(request("DELETE", { expectedRevision: 2, id })); const body = await response.json();
  expect(response.status).toBe(409); expect(body).toMatchObject({ code: "conflict", recoverable: true });
  expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
});

test("unknown records and raw dependency failures return bounded errors without private details", async () => {
  const { repository, handlers } = setup();
  vi.mocked(repository.get).mockRejectedValue(new PlanningStoreError("not_found"));
  expect((await handlers.get(request("GET"))).status).toBe(404);
  vi.mocked(repository.get).mockRejectedValue(new Error("postgresql://private-credential/database SQL detail"));
  const response = await handlers.get(request("GET"));
  expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private-credential");
});
