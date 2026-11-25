import type { PlanView } from "./storage-types";
import type { CalculationSnapshot } from "./snapshot-types";
export type HypotheticalView = { amount: string; before: string; after: string | null; exceedsBy: string | null };
export type PlanningScreen = { scope: string; plan: PlanView; snapshot: CalculationSnapshot | null; calculationError: string | null; hypothetical: HypotheticalView | null };
export type PlanningFailure = { ok: false; code: string; message: string; reloadRequired: boolean };
export type PlanningResponse = { ok: true; screen: PlanningScreen } | PlanningFailure;
export type PlanningMutation = "savePolicy" | "createCommitment" | "updateCommitment" | "removeCommitment";
