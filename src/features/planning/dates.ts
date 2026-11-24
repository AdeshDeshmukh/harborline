import type { CalendarDate } from "./types";
import { validateCalendarDate, validateHorizonDays } from "./validation";

export function horizonEndDate(asOfLocalDate: string, horizonDays: number): CalendarDate {
  const localDate = validateCalendarDate(asOfLocalDate), days = validateHorizonDays(horizonDays);
  // Encode an already-resolved local date as UTC calendar fields, solely to
  // advance the calendar. Never add elapsed milliseconds or use host timezone.
  const calendar = new Date(`${localDate}T00:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate() + days);
  return validateCalendarDate(calendar.toISOString().slice(0, 10));
}
