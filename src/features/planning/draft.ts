import type { PlanView } from "./storage-types";
import { parseAmount } from "./money";
export function isEditStale(plan: PlanView, draft: PlanView["commitments"][number] | null): boolean {
  return !!draft && plan.commitments.find(row => row.id === draft.id)?.revision !== draft.revision;
}
export function hasDuplicateCommitment(plan: PlanView, fields: { label: string; amount: string; dueDate: string }): boolean {
  try {
    const amount = parseAmount(fields.amount);
    return plan.commitments.some(row => row.status !== "removed" && row.label.trim().toLowerCase() === fields.label.trim().toLowerCase() &&
      parseAmount(row.amount) === amount && row.dueDate === fields.dueDate);
  } catch { return false; }
}
