import Decimal from "decimal.js";
import { expect, test } from "vitest";
import { addAmounts, compareAmounts, formatAmountDown, parseAmount, subtractAmounts } from "../src/features/planning/money";
import type { DecimalAmount } from "../src/features/planning/types";
import { PlanningValidationError } from "../src/features/planning/errors";

test("valid amounts canonicalize to decimal strings while retaining exact numeric value", () => {
  for (const [input, output] of [["0.00", "0"], ["12.3400", "12.34"], ["0.000000000000000001", "0.000000000000000001"],
    ["99999999999999999999.999999999999999999", "99999999999999999999.999999999999999999"]]) {
    expect(parseAmount(input)).toBe(output);
  }
  expect(JSON.stringify({ amount: parseAmount("0.30") })).toBe('{"amount":"0.3"}');
});

test("numbers, exponents, non-finite and ambiguous amount syntax are rejected without coercion", () => {
  for (const input of [0, 0.1, NaN, Infinity, null, undefined, true, {}, ["1"], BigInt(1), new Decimal("1"),
    "", " 1", "1 ", "+1", "-0", "-1", "1e3", "1E-3", "NaN", "Infinity", "0x10", "1_000", "1,000", "1,25", "01", ".5", "1.", "１", "1\n"]) {
    expect(() => parseAmount(input)).toThrow(PlanningValidationError);
  }
});

test("NUMERIC(38,18) bounds and explicit input precision are enforced without rounding", () => {
  expect(() => parseAmount("100000000000000000000")).toThrow("Amount exceeds the supported range");
  expect(() => parseAmount("0.0000000000000000001")).toThrow("Amount has more decimal places than supported");
  expect(parseAmount("0.000001", { scale: 6, positive: true })).toBe("0.000001");
  expect(() => parseAmount("1.0000000", { scale: 6 })).toThrow("Amount has more decimal places than supported");
  expect(parseAmount("1", { scale: 0 })).toBe("1");
  expect(() => parseAmount("1.0", { scale: 0 })).toThrow();
  for (const scale of [-1, 19, 1.5, NaN]) expect(() => parseAmount("1", { scale })).toThrow("Decimal scale must be an integer from zero to eighteen");
});

test("positive amounts reject zero instead of inventing a minimum quantity", () => {
  expect(() => parseAmount("0.00", { positive: true })).toThrow("Amount must be greater than zero");
  expect(parseAmount("0")).toBe("0");
});

test("addition and subtraction are exact beyond JavaScript Number and default Decimal precision", () => {
  expect(addAmounts([parseAmount("0.10"), parseAmount("0.20")])).toBe("0.3");
  expect(formatAmountDown(addAmounts([parseAmount("0.10"), parseAmount("0.20")]))).toBe("0.30");
  expect(addAmounts([parseAmount("99999999999999999999.999999999999999998"), parseAmount("0.000000000000000001")]))
    .toBe("99999999999999999999.999999999999999999");
  expect(subtractAmounts(parseAmount("10000000000000000000.000000000000000001"), parseAmount("10000000000000000000")))
    .toBe("0.000000000000000001");
  expect(addAmounts([])).toBe("0");
});

test("arithmetic rejects overflow and negative results instead of silently rounding or clamping", () => {
  expect(() => addAmounts([parseAmount("99999999999999999999.999999999999999999"), parseAmount("0.000000000000000001")]))
    .toThrow("Amount exceeds the supported range");
  expect(() => subtractAmounts(parseAmount("0.1"), parseAmount("0.2"))).toThrow("Amount subtraction would be negative");
  expect(subtractAmounts(parseAmount("0.2"), parseAmount("0.2"))).toBe("0");
});

test("comparisons preserve tiny differences and never use lexicographic order", () => {
  expect(compareAmounts(parseAmount("10"), parseAmount("2"))).toBe(1);
  expect(compareAmounts(parseAmount("0.10"), parseAmount("0.1"))).toBe(0);
  expect(compareAmounts(parseAmount("99999999999999999999.999999999999999998"), parseAmount("99999999999999999999.999999999999999999"))).toBe(-1);
});

test("display rounding always rounds down while leaving exact authority unchanged", () => {
  for (const [input, display] of [["9.999", "9.99"], ["0.009", "0.00"], ["12", "12.00"],
    ["99999999999999999999.999999999999999999", "99999999999999999999.99"]]) {
    const exact = parseAmount(input);
    expect(formatAmountDown(exact)).toBe(display);
    expect(compareAmounts(parseAmount(display), exact)).toBeLessThanOrEqual(0);
    expect(exact).toBe(input);
  }
  expect(formatAmountDown(parseAmount("1.99"), 0)).toBe("1");
});

test("global Decimal configuration changes cannot lower planning arithmetic precision", () => {
  const { precision, rounding } = Decimal;
  try {
    Decimal.set({ precision: 2, rounding: Decimal.ROUND_UP });
    expect(addAmounts([parseAmount("99999999999999999999.999999999999999998"), parseAmount("0.000000000000000001")]))
      .toBe("99999999999999999999.999999999999999999");
    expect(formatAmountDown(parseAmount("9.999"))).toBe("9.99");
  } finally { Decimal.set({ precision, rounding }); }
});

test("runtime arithmetic revalidates strings even if trusted TypeScript brands are bypassed", () => {
  expect(() => addAmounts(["1e3" as DecimalAmount])).toThrow(PlanningValidationError);
  expect(() => compareAmounts("NaN" as DecimalAmount, parseAmount("1"))).toThrow();
  expect(() => formatAmountDown(parseAmount("1"), 19)).toThrow();
});

test("aggregation rejects a scalar string rather than treating its digits as separate amounts", () => {
  expect(() => Reflect.apply(addAmounts, null, ["12"])).toThrow(PlanningValidationError);
});
