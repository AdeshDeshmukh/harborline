import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPlanningController, projectHypothetical } from "../src/features/planning/screen.server";
import { createPlanningService } from "../src/features/planning/service.server";
import { PlanningStoreError } from "../src/features/planning/storage-errors";
import { OwnerAccessError, type OwnerContext } from "../src/features/identity/access.server";
import type { PlanView } from "../src/features/planning/storage-types";
const context = { ownerId: "11111111-1111-4111-8111-111111111111", accountId: "22222222-2222-4222-8222-222222222222", externalRefId: "fixture", timezone: "UTC", email: "builder@example.invalid" } as OwnerContext;
function setup(options: { noPolicy?: boolean; captureFails?: boolean; signedOut?: boolean } = {}) {
  let observations = 0;
  let plan: PlanView = { revision: 2, policy: options.noPolicy ? null : { revision: 2, horizonDays: 30, additionalBuffer: "500", acknowledgedAt: "2026-11-25T00:00:00Z" }, commitments: [] };
  const planning = createPlanningService({ get: async () => structuredClone(plan), mutate: async (_, command) => {
    if (command.expectedRevision !== plan.revision) throw new PlanningStoreError("conflict");
    if (command.kind === "save_policy") { plan = { ...plan, revision: plan.revision + 1, policy: { horizonDays: command.horizonDays, additionalBuffer: command.additionalBuffer, revision: plan.revision + 1, acknowledgedAt: "2026-11-25T00:00:00Z" } }; }
    return structuredClone(plan);
  } });
  const controller = createPlanningController({ owner: async () => { if (options.signedOut) throw new OwnerAccessError("unauthenticated"); return context; }, planning: () => planning,
    calculations: () => ({ latest: async () => null, recordFixtureBalance: async () => { observations++; return { id: "33333333-3333-4333-8333-333333333333" }; },
      capture: async () => { if (options.captureFails) throw new Error("private SQL detail"); throw new Error("capture should not be needed by these tests"); } }) });
  return { controller, planning, observations: () => observations };
}
test.each([
  ["100", { amount: "100", before: "300", after: "200", exceedsBy: null }],
  ["300", { amount: "300", before: "300", after: "0", exceedsBy: null }],
  ["350", { amount: "350", before: "300", after: null, exceedsBy: "50" }],
])("hypothetical %s uses exact server allowance without negative room", (amount, expected) => {
  expect(projectHypothetical("300", amount)).toEqual(expected);
});
test("hypotheticals reject invalid amounts and never use floating-point money", () => {
  expect(projectHypothetical("0.3", "0.10")).toEqual({ amount: "0.1", before: "0.3", after: "0.2", exceedsBy: null });
  for (const input of ["0", "-1", "1e2", "1.001", 100]) expect(() => projectHypothetical("300", input)).toThrow();
});
test("uninitialized policy remains explicit and does not manufacture an explanation", async () => {
  const { controller } = setup({ noPolicy: true });
  expect(await controller.load()).toEqual({ ok: true, screen: { scope: context.accountId, plan: { revision: 2, policy: null, commitments: [] }, snapshot: null, calculationError: null, hypothetical: null } });
});
test("unauthenticated loads and mutations return sign-in guidance without touching storage", async () => {
  const { controller } = setup({ signedOut: true });
  expect(await controller.load()).toMatchObject({ ok: false, code: "unauthenticated", reloadRequired: true });
  expect(await controller.mutate(context.accountId, "savePolicy", {})).toMatchObject({ ok: false, code: "unauthenticated" });
});
test("a successful save remains successful if explanation capture fails afterwards", async () => {
  const { controller, planning } = setup({ captureFails: true });
  const result = await controller.mutate(context.accountId, "savePolicy", { expectedRevision: 2, horizonDays: 60, additionalBuffer: "100", acknowledged: true });
  expect(result).toMatchObject({ ok: true, screen: { plan: { revision: 3, policy: { horizonDays: 60, additionalBuffer: "100" } }, snapshot: null,
    calculationError: "Your plan is saved, but its explanation could not be refreshed. Reload to try again." } });
  expect((await planning.get(context)).revision).toBe(3);
  expect(JSON.stringify(result)).not.toContain("private SQL detail");
});
test("stale writes require reload while invalid fields preserve editable input", async () => {
  const { controller } = setup({ captureFails: true });
  expect(await controller.mutate(context.accountId, "savePolicy", { expectedRevision: 1, horizonDays: 30, additionalBuffer: "100", acknowledged: true })).toMatchObject({ ok: false, code: "conflict", reloadRequired: true });
  expect(await controller.mutate(context.accountId, "savePolicy", { expectedRevision: 2, horizonDays: 30, additionalBuffer: "-1", acknowledged: true })).toMatchObject({ ok: false, code: "invalid_amount", reloadRequired: false });
  expect(await controller.mutate(context.accountId, "savePolicy", { expectedRevision: 2, horizonDays: 30, additionalBuffer: "100", acknowledged: true, accountId: "forged" })).toMatchObject({ ok: false, code: "invalid_request" });
});
test("unknown mutations cannot invoke arbitrary service properties", async () => {
  const { controller } = setup();
  expect(await controller.mutate(context.accountId, "get", {})).toMatchObject({ ok: false, code: "invalid_request", reloadRequired: false });
});

test("initial page reads never record fixture evidence", async () => {
  const { controller, observations } = setup({ captureFails: true });
  const result = await controller.load();
  expect(observations()).toBe(0);
  expect(result).toMatchObject({ ok: true, screen: { snapshot: null, calculationError: "Reload the sample to create an explanation for this plan." } });
});
test("old account scope cannot mutate, refresh or preview under another signed-in account", async () => {
  const { controller, planning } = setup({ captureFails: true });
  const other = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  expect(await controller.mutate(other, "savePolicy", { expectedRevision: 2, horizonDays: 30, additionalBuffer: "0", acknowledged: true })).toMatchObject({ ok: false, code: "session_changed", reloadRequired: true });
  expect(await controller.refresh(other)).toMatchObject({ ok: false, code: "session_changed" });
  expect(await controller.preview(other, "100")).toMatchObject({ ok: false, code: "session_changed" });
  expect((await planning.get(context)).revision).toBe(2);
});
