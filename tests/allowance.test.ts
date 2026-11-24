import { expect, test } from "vitest";
import { calculateAllowance } from "../src/features/planning/calculate-allowance";
import { horizonEndDate } from "../src/features/planning/dates";
import { PlanningValidationError } from "../src/features/planning/errors";
import { addAmounts, compareAmounts, formatAmountDown, parseAmount, subtractAmounts } from "../src/features/planning/money";
import { localDateAt, validateTimezone } from "../src/features/planning/validation";
import type { AllowanceCommitment, AllowanceInput } from "../src/features/planning/types";

const commitment = (id: string, amount: string, dueDate = "2026-12-01", status: AllowanceCommitment["status"] = "outstanding"): AllowanceCommitment => ({ id, amount, dueDate, status });
const input = (overrides: Partial<AllowanceInput> = {}): AllowanceInput => ({ available: "2000", commitments: [commitment("rent", "1200")],
  additionalBuffer: "500", asOfLocalDate: "2026-11-24", horizonDays: 30, policyRevision: 1, ...overrides });

test.each([
  { available: "2000", commitments: [commitment("rent", "1200")], total: "1200", budget: "300", shortfall: "0", ids: ["rent"] },
  { available: "1700", commitments: [commitment("rent", "1200")], total: "1200", budget: "0", shortfall: "0", ids: ["rent"] },
  { available: "1500", commitments: [commitment("rent", "1200")], total: "1200", budget: "0", shortfall: "200", ids: ["rent"] },
  { available: "2000", commitments: [commitment("rent", "1200"), commitment("new-bill", "250")], total: "1450", budget: "50", shortfall: "0", ids: ["rent", "new-bill"] },
])("plan example: available $available yields budget $budget and shortfall $shortfall", ({ available, commitments, total, budget, shortfall, ids }) => {
  expect(calculateAllowance(input({ available, commitments }))).toEqual({ commitmentsTotal: total, additionalBuffer: "500",
    debitBudget: budget, shortfall, includedCommitmentIds: ids, formulaVersion: 1 });
});

test("the first example leaves 1900 cash and 200 extra room after an all-in debit of 100", () => {
  const result = calculateAllowance(input()), debit = parseAmount("100");
  expect(compareAmounts(debit, result.debitBudget)).toBe(-1);
  expect(subtractAmounts(parseAmount("2000"), debit)).toBe("1900");
  expect(addAmounts([result.commitmentsTotal, result.additionalBuffer])).toBe("1700");
  expect(subtractAmounts(result.debitBudget, debit)).toBe("200");
});

test("the debit budget covers all-in cost rather than only the requested buy quantity", () => {
  const result = calculateAllowance(input({ available: "1800" }));
  expect(result.debitBudget).toBe("100");
  // Synthetic fee example only; this test does not establish a provider fee model.
  const allInDebit = addAmounts([parseAmount("100"), parseAmount("0.20")]);
  expect(compareAmounts(allInDebit, result.debitBudget)).toBe(1);
});

test("only available cash feeds the formula; holds are not subtracted again and expected income is ignored", () => {
  const result = calculateAllowance(Object.assign(input({ available: "900", commitments: [commitment("bill", "500")], additionalBuffer: "200" }),
    { total: "1000", held: "100", expectedIncome: "9000" }));
  expect(result.debitBudget).toBe("200");
});

test("overdue, today and exact horizon-end commitments count; paid, removed and later dates do not", () => {
  const result = calculateAllowance(input({ commitments: [commitment("overdue", "10", "2020-01-01"), commitment("today", "20", "2026-11-24"),
    commitment("boundary", "30", "2026-12-24"), commitment("later", "40", "2026-12-25"),
    commitment("paid", "50", "2026-11-24", "paid"), commitment("removed", "60", "2026-11-24", "removed")] }));
  expect(result.includedCommitmentIds).toEqual(["overdue", "today", "boundary"]);
  expect(result.commitmentsTotal).toBe("60");
  expect(result.debitBudget).toBe("1440");
});

test("empty or entirely excluded commitments leave only the chosen additional buffer", () => {
  for (const commitments of [[], [commitment("paid", "10", "2026-11-24", "paid")]]) {
    expect(calculateAllowance(input({ commitments })).debitBudget).toBe("1500");
  }
  expect(calculateAllowance(input({ available: "0", commitments: [], additionalBuffer: "0" })))
    .toMatchObject({ debitBudget: "0", shortfall: "0", commitmentsTotal: "0" });
});

test("tiny exact allowance and shortfall survive without display rounding changing the calculation", () => {
  const result = calculateAllowance(input({ available: "1700.000000000000000001" }));
  expect(result.debitBudget).toBe("0.000000000000000001"); expect(formatAmountDown(result.debitBudget)).toBe("0.00");
  expect(calculateAllowance(input({ available: "1699.999999999999999999" })).shortfall).toBe("0.000000000000000001");
});

test("stored fixed-scale planning values are validated by economic precision after canonicalization", () => {
  expect(calculateAllowance(input({ commitments: [commitment("rent", "1200.500000000000000000")], additionalBuffer: "500.000000000000000000" })))
    .toMatchObject({ commitmentsTotal: "1200.5", additionalBuffer: "500", debitBudget: "299.5" });
  expect(() => calculateAllowance(input({ commitments: [commitment("bad", "1.001")] }))).toThrow(PlanningValidationError);
  expect(() => calculateAllowance(input({ additionalBuffer: "1.001" }))).toThrow(PlanningValidationError);
});

test.each([
  ["2026-11-24", 30, "2026-12-24"], ["2024-02-28", 1, "2024-02-29"], ["2024-02-29", 1, "2024-03-01"],
  ["2026-12-15", 30, "2027-01-14"], ["2026-03-07", 1, "2026-03-08"], ["2026-11-01", 1, "2026-11-02"], ["0001-01-01", 1, "0001-01-02"],
] as const)("calendar horizon %s plus %i days ends on %s", (date, days, expected) => {
  expect(horizonEndDate(date, days)).toBe(expected);
});

test("the same instant gives different horizon inclusion when users have different local dates", () => {
  const instant = new Date("2026-11-24T00:30:00Z"), commitments = [commitment("boundary", "100", "2026-11-25")];
  const utc = localDateAt(instant, validateTimezone("UTC")), west = localDateAt(instant, validateTimezone("America/Los_Angeles"));
  expect(calculateAllowance(input({ asOfLocalDate: utc, horizonDays: 1, commitments })).commitmentsTotal).toBe("100");
  expect(calculateAllowance(input({ asOfLocalDate: west, horizonDays: 1, commitments })).commitmentsTotal).toBe("0");
});

test("malformed planning structures, invalid revisions and dates fail instead of returning a partial budget", () => {
  const invalid = [null, [], {}, input({ commitments: "not-a-list" as unknown as AllowanceCommitment[] }),
    ...[0, -1, 1.5, NaN, 2147483648, "1"].map(policyRevision => ({ ...input(), policyRevision })),
    input({ asOfLocalDate: "2026-02-29" }), input({ horizonDays: 0 }), input({ available: "1e3" }),
    input({ commitments: [null as unknown as AllowanceCommitment] }),
    input({ commitments: [{ ...commitment("bad", "1"), status: "unknown" as AllowanceCommitment["status"] }] }),
    input({ commitments: [commitment("", "1")] }), input({ commitments: [commitment("same", "1"), commitment("same", "2")] }),
    input({ commitments: [commitment("bad", "-1", "2026-12-01", "paid")] }),
    input({ commitments: [commitment("bad", "1", "2026-04-31", "removed")] })];
  for (const candidate of invalid) expect(() => calculateAllowance(candidate as AllowanceInput)).toThrow(PlanningValidationError);
});

test("out-of-range horizon and overflowing combined needs fail explicitly", () => {
  expect(() => horizonEndDate("9999-12-31", 1)).toThrow(PlanningValidationError);
  expect(() => calculateAllowance(input({ commitments: [commitment("large", "99999999999999999999.99")], additionalBuffer: "0.01" })))
    .toThrow("Amount exceeds the supported range");
});

test("calculation is deterministic, does not mutate inputs and returns a frozen explanation", () => {
  const commitments = Object.freeze([Object.freeze(commitment("bill", "1200"))]);
  const data = Object.freeze(input({ commitments })); const result = calculateAllowance(data);
  expect(calculateAllowance(data)).toEqual(result);
  expect(data.commitments[0].amount).toBe("1200");
  expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.includedCommitmentIds)).toBe(true);
});
