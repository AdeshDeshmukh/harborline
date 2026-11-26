import Decimal from "decimal.js";
import { addAmounts, compareAmounts, parseAmount, subtractAmounts } from "../planning/money";
import { MaintenanceError, type ManualClearance, type SettlementBasis } from "./maintenance-types";
const Exact = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_DOWN, minE: -1000, maxE: 1000 });
const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function normalizeManualClearance(value: unknown): ManualClearance {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    const r = structuredClone(value) as Record<string, unknown>, keys = ["intentId", "observationId", "requestKey", "actualDebit", "interveningCredits", "interveningDebits", "references"];
    if (Object.keys(r).length !== keys.length || Object.keys(r).some(k => !keys.includes(k)) || ![r.intentId, r.observationId, r.requestKey].every(isUuid))
      throw new Error();
    const refs = r.references as Record<string, unknown>;
    if (!refs || typeof refs !== "object" || Array.isArray(refs) || Object.keys(refs).length !== 4 || !["order", "wallet", "balance", "activity"].every(k => typeof refs[k] === "string" && /^fixture:[A-Za-z0-9_-]{1,128}$/.test(refs[k] as string)))
      throw new Error();
    const amount = (v: unknown) => parseAmount(parseAmount(v), { scale: 6 });
    return Object.freeze({ intentId: (r.intentId as string).toLowerCase(), observationId: (r.observationId as string).toLowerCase(), requestKey: (r.requestKey as string).toLowerCase(), actualDebit: amount(r.actualDebit), interveningCredits: amount(r.interveningCredits), interveningDebits: amount(r.interveningDebits), references: Object.freeze({ order: refs.order as string, wallet: refs.wallet as string, balance: refs.balance as string, activity: refs.activity as string }) });
  }
  catch {
    throw new MaintenanceError("invalid_request");
  }
}
export function reconcileManualCash(basis: SettlementBasis, available: string, input: ManualClearance): string {
  try {
    const e = basis.evidence;
    if (e.filledBase === null || e.remainingBase === null || e.feeQuote === null || !["complete", "failed", "canceled"].includes(e.providerStatus))
      throw new Error();
    const debit = parseAmount(input.actualDebit), fee = parseAmount(e.feeQuote), zero = parseAmount("0");
    if (compareAmounts(debit, parseAmount(basis.maximumDebit)) > 0 || compareAmounts(debit, fee) < 0 || e.filledBase === "0" && (debit !== zero || fee !== zero) || e.filledBase !== "0" && compareAmounts(debit, fee) <= 0)
      throw new Error();
    if (e.averagePriceQuote !== null) {
      if (e.filledBase !== "0" && basis.feeTreatment !== "added_to_input")
        throw new Error();
      const actual = new Exact(parseAmount(e.filledBase)).times(parseAmount(e.averagePriceQuote)).plus(fee).toFixed();
      if (parseAmount(actual, { scale: 6 }) !== debit)
        throw new Error();
    }
    const expected = subtractAmounts(addAmounts([parseAmount(basis.beforeAvailable), parseAmount(input.interveningCredits)]), addAmounts([debit, parseAmount(input.interveningDebits)]));
    if (expected !== parseAmount(available))
      throw new Error();
    return expected;
  }
  catch {
    throw new MaintenanceError("conflict");
  }
}
export function automaticSettlementEvidence() { return Object.freeze({ kind: "unverified" as const, reason: "provider_consistency_unverified" as const }); }
