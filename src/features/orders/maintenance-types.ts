import type { RecoveryEvidence } from "./recovery-types";
export class MaintenanceError extends Error {
  constructor(readonly code: "disabled" | "invalid_request" | "not_found" | "conflict" | "unavailable") { super("Order maintenance is unavailable"); this.name = "MaintenanceError"; }
}
export type WorkLease = Readonly<{
  id: string;
  intentId: string;
  token: string;
  attempts: number;
}>;
export type SettlementBasis = Readonly<{
  intentId: string;
  revision: number;
  readId: string;
  providerUserId: string;
  cashId: string;
  providerOrderId: string;
  maximumDebit: string;
  beforeAvailable: string;
  terminalAt: string;
  feeTreatment: "added_to_input" | "included_in_input";
  evidence: RecoveryEvidence;
}>;
export type ManualClearance = Readonly<{
  intentId: string;
  observationId: string;
  requestKey: string;
  actualDebit: string;
  interveningCredits: string;
  interveningDebits: string;
  references: Readonly<{
    order: string;
    wallet: string;
    balance: string;
    activity: string;
  }>;
}>;
export function maintenanceTime(clock: () => Date) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new MaintenanceError("unavailable");
  return new Date(value);
}
export type BalanceRead = SettlementBasis & Readonly<{
  balanceReadId: string;
  balanceStartedAt: string;
}>;
