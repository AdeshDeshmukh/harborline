import { expect, test } from "vitest";
import { applyDemoCommitment, demoAllowance, demoReviewScenario, startDemo } from "../src/features/demo/demo-plan";

test("a changed commitment lowers the allowance to zero and invalidates the saved review", () => {
  const initial = startDemo();
  expect(demoAllowance(initial)).toMatchObject({ commitmentsTotal: "1200", additionalBuffer: "500", debitBudget: "300" });
  expect(demoReviewScenario(initial)).toBe("current");
  const changed = applyDemoCommitment(initial, "1500");
  expect(demoAllowance(changed)).toMatchObject({ debitBudget: "0", shortfall: "0" });
  expect(demoReviewScenario(changed)).toBe("changed");
  expect(demoReviewScenario(applyDemoCommitment(changed, "1200"))).toBe("changed");
  expect(demoReviewScenario(startDemo())).toBe("current");
});

test("invalid amounts and equivalent edits do not replace the original plan", () => {
  const initial = startDemo();
  expect(applyDemoCommitment(initial, "1200.00")).toBe(initial);
  for (const amount of ["0", "-1", "", "1e3", "200.001", "1,500", "999999999999999999999"]) {
    expect(() => applyDemoCommitment(initial, amount)).toThrow();
  }
  expect(demoAllowance(initial).debitBudget).toBe("300");
});

test("a larger rent shows a shortfall without producing a negative allowance", () => {
  expect(demoAllowance(applyDemoCommitment(startDemo(), "1600"))).toMatchObject({ debitBudget: "0", shortfall: "100" });
});
