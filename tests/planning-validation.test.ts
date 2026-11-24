import { expect, test } from "vitest";
import { PlanningValidationError } from "../src/features/planning/errors";
import { localDateAt, validateAssetQuantity, validateBufferAmount, validateCalendarDate, validateCommitmentAmount,
  validateHorizonDays, validateTimezone } from "../src/features/planning/validation";

test("commitments are positive and buffers may be zero, with at most two entered decimal places", () => {
  expect(validateCommitmentAmount("1200.50")).toBe("1200.5");
  expect(validateBufferAmount("0.00")).toBe("0");
  expect(() => validateCommitmentAmount("0")).toThrow("Amount must be greater than zero");
  for (const value of ["1.001", "1.000", "-1", 1]) {
    expect(() => validateCommitmentAmount(value)).toThrow(PlanningValidationError);
    expect(() => validateBufferAmount(value)).toThrow(PlanningValidationError);
  }
});

test("asset quantities require explicit supported listing precision, never an assumed USDC scale", () => {
  expect(validateAssetQuantity("0.000001", 6)).toBe("0.000001");
  expect(validateAssetQuantity("0.000000000000000001", 18)).toBe("0.000000000000000001");
  expect(validateAssetQuantity("1", 0)).toBe("1");
  expect(() => validateAssetQuantity("0.0000001", 6)).toThrow("Amount has more decimal places than supported");
  expect(() => validateAssetQuantity("0", 6)).toThrow("Amount must be greater than zero");
  for (const scale of [undefined, null, "6", -1, 19, 6.5, NaN]) expect(() => validateAssetQuantity("1", scale)).toThrow(PlanningValidationError);
});

test("calendar dates preserve genuine Gregorian dates including leap days and bounded years", () => {
  for (const value of ["0001-01-01", "2000-02-29", "2024-02-29", "2026-11-24", "9999-12-31"]) {
    expect(validateCalendarDate(value)).toBe(value);
  }
});

test("impossible dates, timestamp syntax and non-string dates cannot enter a commitment", () => {
  for (const value of ["0000-01-01", "10000-01-01", "1900-02-29", "2026-02-29", "2026-04-31", "2026-00-01", "2026-01-00", "2026-13-01",
    "2026-1-01", "2026-01-01T00:00:00Z", " 2026-01-01", "2026-01-01\n", "", new Date(), 20260101, null]) {
    expect(() => validateCalendarDate(value)).toThrow(PlanningValidationError);
  }
});

test("timezones require UTC or a supported named IANA region rather than ambiguous abbreviations", () => {
  for (const timezone of ["UTC", "Asia/Kolkata", "America/New_York", "Pacific/Kiritimati", "Etc/GMT+5"]) {
    expect(validateTimezone(timezone)).toBe(timezone);
  }
  for (const timezone of ["EST", "+05:30", "GMT", "America/Not_A_Zone", " Asia/Kolkata", "UTC\n", "", null, 5]) {
    expect(() => validateTimezone(timezone)).toThrow(PlanningValidationError);
  }
});

test("local dates follow the supplied timezone across UTC midnight and the international date line", () => {
  const instant = new Date("2026-11-24T00:30:00Z");
  expect(localDateAt(instant, validateTimezone("UTC"))).toBe("2026-11-24");
  expect(localDateAt(instant, validateTimezone("America/Los_Angeles"))).toBe("2026-11-23");
  expect(localDateAt(new Date("2026-11-24T12:00:00Z"), validateTimezone("Pacific/Kiritimati"))).toBe("2026-11-25");
  expect(localDateAt(new Date("2026-11-23T18:45:00Z"), validateTimezone("Asia/Kolkata"))).toBe("2026-11-24");
});

test("daylight-saving transitions do not move a commitment's local calendar date", () => {
  const timezone = validateTimezone("America/New_York");
  expect(localDateAt(new Date("2026-03-08T06:59:00Z"), timezone)).toBe("2026-03-08");
  expect(localDateAt(new Date("2026-03-08T07:01:00Z"), timezone)).toBe("2026-03-08");
  expect(localDateAt(new Date("2026-11-01T05:30:00Z"), timezone)).toBe("2026-11-01");
  expect(localDateAt(new Date("2026-11-01T06:30:00Z"), timezone)).toBe("2026-11-01");
});

test("invalid instants and dates outside the supported calendar range fail explicitly", () => {
  const timezone = validateTimezone("UTC");
  for (const instant of [new Date(NaN), new Date("0000-01-01T00:00:00Z"), new Date("+010000-01-01T00:00:00Z")]) {
    expect(() => localDateAt(instant, timezone)).toThrow(PlanningValidationError);
  }
});

test("planning horizons are explicit integer calendar-day counts from one to ninety", () => {
  for (const days of [1, 30, 90]) expect(validateHorizonDays(days)).toBe(days);
  for (const days of [0, -1, 91, 1.5, NaN, Infinity, "30", null, undefined]) {
    expect(() => validateHorizonDays(days)).toThrow(PlanningValidationError);
  }
});
