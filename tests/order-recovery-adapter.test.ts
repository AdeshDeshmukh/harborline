import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createOrderRecoveryAdapter } from "../src/integrations/truemarkets/recovery.server";
const input = { providerUserId: "33333333-3333-4333-8333-333333333333", providerOrderId: "fixture_order_1" };
test("recovery uses only one scoped GET and has no execute dependency", async () => {
  let seen: unknown;
  const adapter = createOrderRecoveryAdapter({ async request(method, path, options) { seen = { method, path, ...options }; return { status: "pending" }; } }, "contract_fixture");
  expect(await adapter.read(input)).toEqual({ source: "contract_fixture", kind: "response", body: { status: "pending" } });
  expect(seen).toEqual({ method: "GET", path: "/v1/gateway/orders/fixture_order_1", userId: input.providerUserId });
});
test.each([undefined, "provider"] as const)("source %s cannot access the transport", async (source) => {
  let calls = 0;
  const adapter = createOrderRecoveryAdapter({ async request() { calls++; return {}; } }, source);
  await expect(adapter.read(input)).rejects.toMatchObject({ code: "disabled" });
  expect(calls).toBe(0);
});
test.each([404, 500])("HTTP %i stays uncertain without exposing upstream details", async (status) => {
  const adapter = createOrderRecoveryAdapter({ async request() { throw Object.assign(new Error("private response"), { status }); } }, "contract_fixture");
  expect(await adapter.read(input)).toEqual({ source: "contract_fixture", kind: status === 404 ? "not_found" : "unavailable" });
});
