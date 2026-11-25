import { expect, test } from "vitest";
import { isEditStale, hasDuplicateCommitment } from "../src/features/planning/draft";
import type { PlanView } from "../src/features/planning/storage-types";
const draft = { id: "bill", label: "Rent", amount: "1200", dueDate: "2026-12-01", status: "outstanding" as const, revision: 1 };
const plan: PlanView = { revision: 4, policy: null, commitments: [{ ...draft, amount: "1300", revision: 2 }] };
test("changed or removed edit baselines cannot be silently rebased onto a newer plan revision", () => {
  expect(isEditStale(plan, draft)).toBe(true);
  expect(isEditStale({ ...plan, commitments: [] }, draft)).toBe(true);
  expect(isEditStale({ ...plan, commitments: [{ ...draft, status: "paid", revision: 2 }] }, draft)).toBe(true);
});
test("another row's changes do not invalidate an unchanged edit baseline", () => {
  expect(isEditStale({ ...plan, commitments: [draft] }, draft)).toBe(false);
  expect(isEditStale(plan, null)).toBe(false);
});
test("exact outstanding duplicates prompt confirmation while distinct or removed obligations do not", () => {
  expect(hasDuplicateCommitment({ ...plan, commitments: [draft] }, { label: " rent ", amount: "1200.00", dueDate: "2026-12-01" })).toBe(true);
  expect(hasDuplicateCommitment(plan, { label: "Rent", amount: "1200", dueDate: "2026-12-01" })).toBe(false);
  expect(hasDuplicateCommitment({ ...plan, commitments: [{ ...draft, status: "removed" }] }, draft)).toBe(false);
  expect(hasDuplicateCommitment({ ...plan, commitments: [draft] }, { ...draft, dueDate: "2026-12-02" })).toBe(false);
});
