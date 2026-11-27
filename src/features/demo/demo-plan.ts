import { calculateAllowance } from "../planning/calculate-allowance";
import { validateCommitmentAmount } from "../planning/validation";

export const demoCash = "2000";
const demoBuffer = "500";
const initialRent = "1200";
const initialRevision = 2;
const asOfLocalDate = "2026-11-25";
type DemoPlan = Readonly<{ rent: string; revision: number }>;

export function startDemo(): DemoPlan {
  return { rent: initialRent, revision: initialRevision };
}

export function applyDemoCommitment(plan: DemoPlan, input: string): DemoPlan {
  const rent = validateCommitmentAmount(input.trim());
  if (rent === plan.rent) return plan;
  return { rent, revision: plan.revision + 1 };
}

export function demoAllowance(plan: DemoPlan) {
  return calculateAllowance({
    available: demoCash,
    additionalBuffer: demoBuffer,
    asOfLocalDate,
    horizonDays: 30,
    policyRevision: plan.revision,
    commitments: [{ id: "sample-rent", amount: plan.rent, dueDate: asOfLocalDate, status: "outstanding" }],
  });
}

export function demoReviewScenario(plan: DemoPlan): "current" | "changed" {
  return plan.revision === initialRevision ? "current" : "changed";
}
