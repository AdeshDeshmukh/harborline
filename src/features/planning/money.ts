import type { DecimalAmount } from "./types";
import Decimal from "decimal.js";
import { PlanningValidationError } from "./errors";

// Private constructor: changes to the library's global precision/rounding must
// not alter authorization arithmetic. 80 digits exceed bounded additive results.
const Exact = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_DOWN, minE: -1000, maxE: 1000 });

export function parseAmount(value: unknown, options: { scale?: number; positive?: boolean } = {}): DecimalAmount {
  const scale = options.scale ?? 18;
  validateScale(scale);
  if (typeof value !== "string" || value.length === 0 || value.length > 64) throw new PlanningValidationError("invalid_amount");
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  // JS $ may stop before a trailing newline; require the entire input match.
  if (!match || match[0] !== value) throw new PlanningValidationError("invalid_amount");
  if (match[1].length > 20) throw new PlanningValidationError("amount_out_of_range");
  if ((match[2]?.length ?? 0) > scale) throw new PlanningValidationError("unsupported_precision");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  const canonical = `${match[1]}${fraction ? `.${fraction}` : ""}`;
  if (options.positive && canonical === "0") throw new PlanningValidationError("amount_must_be_positive");
  return canonical as DecimalAmount;
}
export function addAmounts(values: readonly DecimalAmount[]): DecimalAmount {
  if (!Array.isArray(values)) throw new PlanningValidationError("invalid_amount");
  let sum = parseAmount("0");
  for (const value of values) sum = parseAmount(new Exact(sum).plus(parseAmount(value)).toFixed());
  return sum;
}
export function subtractAmounts(left: DecimalAmount, right: DecimalAmount): DecimalAmount {
  const a = new Exact(parseAmount(left)), b = new Exact(parseAmount(right));
  if (a.lessThan(b)) throw new PlanningValidationError("negative_result");
  return parseAmount(a.minus(b).toFixed());
}
export function compareAmounts(left: DecimalAmount, right: DecimalAmount): -1 | 0 | 1 {
  return new Exact(parseAmount(left)).comparedTo(parseAmount(right)) as -1 | 0 | 1;
}
export function formatAmountDown(value: DecimalAmount, scale = 2): string {
  validateScale(scale);
  return new Exact(parseAmount(value)).toFixed(scale, Decimal.ROUND_DOWN);
}

function validateScale(scale: number) {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) throw new PlanningValidationError("invalid_scale");
}
