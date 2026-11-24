import type { CalendarDate, DecimalAmount, IanaTimezone, PlanningHorizon } from "./types";
import { parseAmount } from "./money";
import { PlanningValidationError } from "./errors";

export function validateCommitmentAmount(value: unknown): DecimalAmount { return parseAmount(value, { scale: 2, positive: true }); }
export function validateBufferAmount(value: unknown): DecimalAmount { return parseAmount(value, { scale: 2 }); }
export function validateAssetQuantity(value: unknown, listingScale: unknown): DecimalAmount {
  if (typeof listingScale !== "number") throw new PlanningValidationError("invalid_scale");
  return parseAmount(value, { scale: listingScale, positive: true });
}
export function validateCalendarDate(value: unknown): CalendarDate {
  if (typeof value !== "string" || value.length !== 10 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) throw new PlanningValidationError("invalid_date");
  // Numbers here represent bounded calendar fields, never monetary amounts.
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) throw new PlanningValidationError("invalid_date");
  return value as CalendarDate;
}
export function validateTimezone(value: unknown): IanaTimezone {
  if (typeof value !== "string" || value.length > 64 || (value !== "UTC" &&
    /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.exec(value)?.[0] !== value)) throw new PlanningValidationError("invalid_timezone");
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0); }
  catch { throw new PlanningValidationError("invalid_timezone"); }
  return value as IanaTimezone;
}
export function localDateAt(instant: Date, timezone: IanaTimezone): CalendarDate {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw new PlanningValidationError("invalid_date");
  const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone: validateTimezone(timezone), year: "numeric", month: "2-digit", day: "2-digit", era: "short",
  }).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  if (field("era") !== "AD") throw new PlanningValidationError("invalid_date");
  return validateCalendarDate(`${field("year").padStart(4, "0")}-${field("month")}-${field("day")}`);
}
export function validateHorizonDays(value: unknown): PlanningHorizon {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 90) throw new PlanningValidationError("invalid_horizon");
  return value as PlanningHorizon;
}
