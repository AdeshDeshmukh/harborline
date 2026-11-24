import type { AllowanceInput, AllowanceResult, DecimalAmount } from "./types";
import { PlanningValidationError } from "./errors";
import { addAmounts, compareAmounts, parseAmount, subtractAmounts } from "./money";
import { validateBufferAmount, validateCalendarDate, validateCommitmentAmount } from "./validation";
import { horizonEndDate } from "./dates";

export function calculateAllowance(input: AllowanceInput): AllowanceResult {
  if (!input || typeof input !== "object" || Array.isArray(input) || !Array.isArray(input.commitments)) throw new PlanningValidationError("invalid_allowance_input");
  if (!Number.isInteger(input.policyRevision) || input.policyRevision < 1 || input.policyRevision > 2147483647) throw new PlanningValidationError("invalid_policy_revision");
  const available = parseAmount(input.available);
  const additionalBuffer = validateBufferAmount(parseAmount(input.additionalBuffer));
  const horizonEnd = horizonEndDate(input.asOfLocalDate, input.horizonDays);
  const seen = new Set<string>(), includedCommitmentIds: string[] = [], includedAmounts: DecimalAmount[] = [];
  for (const commitment of input.commitments) {
    if (!commitment || typeof commitment !== "object" || Array.isArray(commitment) ||
      typeof commitment.id !== "string" || !commitment.id.trim() ||
      !["outstanding", "paid", "removed"].includes(commitment.status)) throw new PlanningValidationError("invalid_commitment");
    if (seen.has(commitment.id)) throw new PlanningValidationError("duplicate_commitment");
    seen.add(commitment.id);
    // Repository NUMERIC values may be padded to 18 places. Validate their
    // canonical value against the two-place planning policy, not their padding.
    const amount = validateCommitmentAmount(parseAmount(commitment.amount));
    const dueDate = validateCalendarDate(commitment.dueDate);
    if (commitment.status === "outstanding" && dueDate <= horizonEnd) {
      includedCommitmentIds.push(commitment.id); includedAmounts.push(amount);
    }
  }
  const commitmentsTotal = addAmounts(includedAmounts);
  const plannedNeeds = addAmounts([commitmentsTotal, additionalBuffer]);
  const covered = compareAmounts(available, plannedNeeds) >= 0;
  return Object.freeze({ commitmentsTotal, additionalBuffer,
    debitBudget: covered ? subtractAmounts(available, plannedNeeds) : parseAmount("0"),
    shortfall: covered ? parseAmount("0") : subtractAmounts(plannedNeeds, available),
    includedCommitmentIds: Object.freeze(includedCommitmentIds), formulaVersion: 1 });
}
