declare const decimalAmount: unique symbol;
declare const calendarDate: unique symbol;
declare const ianaTimezone: unique symbol;
declare const planningHorizon: unique symbol;

/** Validated, canonical, nonnegative NUMERIC(38,18) decimal string. */
export type DecimalAmount = string & { readonly [decimalAmount]: true };
/** Gregorian calendar date, independent of UTC timestamp conversion. */
export type CalendarDate = string & { readonly [calendarDate]: true };
export type IanaTimezone = string & { readonly [ianaTimezone]: true };
export type PlanningHorizon = number & { readonly [planningHorizon]: true };
