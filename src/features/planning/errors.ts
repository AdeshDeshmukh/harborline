export type PlanningValidationCode = "invalid_amount" | "unsupported_precision" | "amount_out_of_range" |
  "amount_must_be_positive" | "negative_result" | "invalid_scale" | "invalid_date" | "invalid_timezone" | "invalid_horizon";
const messages: Record<PlanningValidationCode, string> = {
  invalid_amount: "Enter an unsigned decimal amount without spaces or separators",
  unsupported_precision: "Amount has more decimal places than supported",
  amount_out_of_range: "Amount exceeds the supported range",
  amount_must_be_positive: "Amount must be greater than zero",
  negative_result: "Amount subtraction would be negative",
  invalid_scale: "Decimal scale must be an integer from zero to eighteen",
  invalid_date: "Enter a valid calendar date in YYYY-MM-DD format",
  invalid_timezone: "Choose a supported IANA timezone",
  invalid_horizon: "Planning horizon must be an integer from one to ninety days",
};
export class PlanningValidationError extends Error {
  constructor(readonly code: PlanningValidationCode) { super(messages[code]); this.name = "PlanningValidationError"; }
}
