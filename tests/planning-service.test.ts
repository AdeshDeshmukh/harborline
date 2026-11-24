import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPlanningService } from "../src/features/planning/service.server";
import type { PlanningRepository, PlanView } from "../src/features/planning/storage-types";
import type { OwnerContext } from "../src/features/identity/access.server";
import { PlanningStoreError } from "../src/features/planning/storage-errors";
import { PlanningValidationError } from "../src/features/planning/errors";
async function rejectedInput(promise: Promise<unknown>) {
  try { await promise; expect.fail("Invalid input must be rejected"); }
  catch (error) { expect(error instanceof PlanningStoreError || error instanceof PlanningValidationError).toBe(true); }
}

const context = { ownerId: "44444444-4444-4444-8444-444444444444", accountId: "55555555-5555-4555-8555-555555555555" } as OwnerContext;
const id = "66666666-6666-4666-8666-666666666666";
function setup() {
  const view: PlanView = { revision: 1, policy: null, commitments: [] };
  const repository: PlanningRepository = { get: vi.fn(async () => view), mutate: vi.fn(async () => view) };
  return { repository, service: createPlanningService(repository) };
}

test("policy saving requires explicit acknowledgement, horizon, buffer and current revision", async () => {
  const { service, repository } = setup();
  await service.savePolicy(context, { expectedRevision: 1, horizonDays: 30, additionalBuffer: "500.00", acknowledged: true });
  expect(repository.mutate).toHaveBeenCalledWith(context, { kind: "save_policy", expectedRevision: 1, horizonDays: 30, additionalBuffer: "500" });
});

test("commitment edits normalize labels and amounts while preserving dated values and target identity", async () => {
  const { service, repository } = setup();
  await service.createCommitment(context, { expectedRevision: 2, label: "  Rent  ", amount: "1200.50", dueDate: "2026-12-01" });
  expect(repository.mutate).toHaveBeenLastCalledWith(context, { kind: "create", expectedRevision: 2, label: "Rent", amount: "1200.5", dueDate: "2026-12-01" });
  await service.updateCommitment(context, { expectedRevision: 3, id, status: "paid" });
  expect(repository.mutate).toHaveBeenLastCalledWith(context, { kind: "update", expectedRevision: 3, id, changes: { status: "paid" } });
  await service.removeCommitment(context, { expectedRevision: 4, id });
  expect(repository.mutate).toHaveBeenLastCalledWith(context, { kind: "remove", expectedRevision: 4, id });
});

test("unknown identity fields, implicit policy values and invalid revisions never reach storage", async () => {
  const { service, repository } = setup();
  const policy = { expectedRevision: 1, horizonDays: 30, additionalBuffer: "0", acknowledged: true };
  for (const body of [{ ...policy, ownerId: "attacker" }, { ...policy, accountId: context.accountId },
    { ...policy, acknowledged: false }, { ...policy, horizonDays: undefined }, { ...policy, expectedRevision: 0 },
    { ...policy, expectedRevision: "1" }, { ...policy, expectedRevision: 2147483647 }, { ...policy, additionalBuffer: 0 }, null, []]) {
    await rejectedInput(service.savePolicy(context, body));
  }
  expect(repository.mutate).not.toHaveBeenCalled();
});

test("malformed dates, money, labels, status and empty patches are rejected before any write", async () => {
  const { service, repository } = setup();
  const create = { expectedRevision: 1, label: "Rent", amount: "1.00", dueDate: "2026-12-01" };
  for (const body of [{ ...create, amount: "0" }, { ...create, amount: "1e3" }, { ...create, amount: "1.001" },
    { ...create, dueDate: "2026-02-29" }, { ...create, label: " " }, { ...create, label: "a".repeat(121) },
    { ...create, label: "private\nlabel" }, { ...create, id }]) await rejectedInput(service.createCommitment(context, body));
  for (const body of [{ expectedRevision: 1, id }, { expectedRevision: 1, id, status: "unknown" },
    { expectedRevision: 1, id: "bad", status: "paid" }, { expectedRevision: 1, id, revision: 99, status: "paid" }]) {
    await rejectedInput(service.updateCommitment(context, body));
  }
  expect(repository.mutate).not.toHaveBeenCalled();
});
