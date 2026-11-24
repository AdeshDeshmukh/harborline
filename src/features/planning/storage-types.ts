import type { OwnerContext } from "../identity/access.server";

export type CommitmentStatus = "outstanding" | "paid" | "removed";
export type CommitmentFields = { label: string; amount: string; dueDate: string; status: CommitmentStatus };
export type PlanView = {
  revision: number;
  policy: { horizonDays: number; additionalBuffer: string; acknowledgedAt: string; revision: number } | null;
  commitments: Array<CommitmentFields & { id: string; revision: number }>;
};
export type PlanningCommand = { expectedRevision: number } & (
  | { kind: "save_policy"; horizonDays: number; additionalBuffer: string }
  | { kind: "create"; label: string; amount: string; dueDate: string }
  | { kind: "update"; id: string; changes: Partial<CommitmentFields> }
  | { kind: "remove"; id: string }
);
export type PlanningRepository = {
  get(context: OwnerContext): Promise<PlanView>;
  mutate(context: OwnerContext, command: PlanningCommand): Promise<PlanView>;
};
