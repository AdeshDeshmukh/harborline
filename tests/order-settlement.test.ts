import { expect, test } from "vitest";
import { normalizeManualClearance, reconcileManualCash, automaticSettlementEvidence } from "../src/features/orders/settlement-contracts";
import { MaintenanceError } from "../src/features/orders/maintenance-types";
import type { SettlementBasis } from "../src/features/orders/maintenance-types";
const id = "11111111-1111-4111-8111-111111111111";
const input = () => ({ intentId: id, observationId: id, requestKey: id, actualDebit: "100.5", interveningCredits: "5", interveningDebits: "2", references: { order: "fixture:order", wallet: "fixture:wallet", balance: "fixture:balance", activity: "fixture:activity" } });
const basis = { beforeAvailable: "2000", maximumDebit: "100.5", feeTreatment: "added_to_input", evidence: { providerStatus: "complete", filledBase: "0.5", remainingBase: "0", feeQuote: "0.5", averagePriceQuote: "200", partial: false } } as SettlementBasis;
test("manual accounting reconciles actual debit and all intervening cash activity exactly", () => { expect(reconcileManualCash(basis, "1902.5", normalizeManualClearance(input()))).toBe("1902.5"); });
test.each([{ actualDebit: "101" }, { actualDebit: "0.5" }, { actualDebit: "NaN" }, { actualDebit: "100.5000001" }, { verified: true }, { references: { order: "https://private", wallet: "fixture:w", balance: "fixture:b", activity: "fixture:a" } }])("unbounded or fabricated proof rejects: %j", fields => { expect(() => reconcileManualCash(basis, "1902.5", normalizeManualClearance({ ...input(), ...fields }))).toThrow(MaintenanceError); });
test("unexplained cash delta and unknown actual fees cannot authorize clearance", () => { expect(() => reconcileManualCash(basis, "1902.51", normalizeManualClearance(input()))).toThrow(MaintenanceError); expect(() => reconcileManualCash({ ...basis, evidence: { ...basis.evidence, feeQuote: null } }, "1902.5", normalizeManualClearance(input()))).toThrow(MaintenanceError); });
test("provider complete alone never creates automatic settlement authority", () => { expect(automaticSettlementEvidence()).toMatchObject({ kind: "unverified", reason: "provider_consistency_unverified" }); });
test("UUID case is canonicalized so equivalent proof requests replay consistently", () => {
  const value = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  expect(normalizeManualClearance({ ...input(), intentId: value, observationId: value, requestKey: value })).toMatchObject({ intentId: value.toLowerCase(), observationId: value.toLowerCase(), requestKey: value.toLowerCase() });
});
test("a debit contradicting known actual fill economics cannot clear even when cash arithmetic matches", () => {
  const partial = { ...basis, feeTreatment: "added_to_input" as const, evidence: { ...basis.evidence, providerStatus: "failed" as const, filledBase: "0.2", remainingBase: "0.3", feeQuote: "0.2", averagePriceQuote: "200", partial: true } };
  expect(() => reconcileManualCash(partial, "1999", normalizeManualClearance({ ...input(), actualDebit: "1", interveningCredits: "0", interveningDebits: "0" }))).toThrow(MaintenanceError);
});
test("supported 128-character order identity fits a bounded proof reference", () => {
  const value = "o".repeat(128);
  expect(normalizeManualClearance({ ...input(), references: { ...input().references, order: "fixture:" + value } }).references.order).toBe("fixture:" + value);
});
test("unknown actual VWAP permits independently attested debit while unresolved rounding fails closed", () => {
  const partial = { ...basis, evidence: { ...basis.evidence, providerStatus: "failed" as const, filledBase: "0.2", remainingBase: "0.3", feeQuote: "0.2", averagePriceQuote: null, partial: true } };
  const p = normalizeManualClearance({ ...input(), actualDebit: "40.2", interveningCredits: "0", interveningDebits: "0" });
  expect(reconcileManualCash(partial, "1959.8", p)).toBe("1959.8");
  expect(() => reconcileManualCash({ ...partial, evidence: { ...partial.evidence, averagePriceQuote: "200.000001" } }, "1959.8", p)).toThrow(MaintenanceError);
});
