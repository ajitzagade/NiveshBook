import type { Money, Percent } from "@niveshbook/types";

/**
 * AD-2's single designated arithmetic module: every `sharePercent`/monetary
 * value crosses this file's boundary functions before it's stored or
 * compared. `packages/config`'s `noRawMoneyArithmetic` eslint rule exempts
 * exactly this file (`src/decimal-math.ts`) from the `parseFloat`/
 * `parseInt`/`Number()` ban that applies everywhere else in `packages/core`/
 * `packages/db` -- but this module deliberately avoids them anyway
 * (see `parseScaled`/`formatScaled` and `parseMoneyScaled` below) so
 * percentages/money are exact to their declared decimal places with no
 * binary-floating-point rounding, not merely "technically allowed to use
 * float coercion here".
 */

const DECIMAL_PLACES = 4;
const SCALE = 10 ** DECIMAL_PLACES;

/** Thrown by `toPercent` for a value that isn't `0 < x <= 100` with at most 4 decimal places. */
export class InvalidPercentError extends Error {
  constructor(raw: string) {
    super(
      `"${raw}" is not a valid Share % -- must be greater than 0, at most 100, with up to 4 decimal places.`,
    );
    this.name = "InvalidPercentError";
  }
}

function digitValue(char: string): number {
  const code = char.charCodeAt(0) - 48; // '0'.charCodeAt(0) === 48
  if (code < 0 || code > 9) {
    throw new Error(`Not a digit: "${char}"`);
  }
  return code;
}

function digitsToInt(digits: string): number {
  let value = 0;
  for (const char of digits) {
    value = value * 10 + digitValue(char);
  }
  return value;
}

/**
 * Parses a plain decimal string (e.g. "33.33", "100", "0.0001") into an
 * integer scaled by `SCALE` (10000, i.e. 4 decimal places), using only
 * string/digit arithmetic -- never `parseFloat`/`Number()` -- so the result
 * is exact for any input with up to 4 fractional digits. Throws
 * `InvalidPercentError` for anything that isn't a bare, non-negative
 * decimal (no sign, no exponent, no thousands separators, at most 4
 * fractional digits).
 */
function parseScaled(raw: string): number {
  // `\d{1,3}` and `\d{1,4}` are disjoint, non-nested, and both bounded (the
  // second only ever matches after a literal `.`) -- linear-time, no
  // catastrophic backtracking; `safe-regex`'s heuristic just flags any two
  // quantified groups in one pattern. The whole-number part is capped at 3
  // digits (not open-ended `\d+`) since a valid Percent is always <= 100 --
  // this also rejects a pathologically long digit string outright, before
  // `digitsToInt` ever runs over it.
  // eslint-disable-next-line security/detect-unsafe-regex
  const match = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(raw);
  if (!match) {
    throw new InvalidPercentError(raw);
  }
  const [, wholePart, fractionPart = ""] = match;
  const paddedFraction = fractionPart.padEnd(DECIMAL_PLACES, "0");
  return digitsToInt(wholePart) * SCALE + digitsToInt(paddedFraction);
}

/** Formats an integer scaled by `SCALE` back into a plain decimal string, e.g. `833300 -> "83.33"`. */
function formatScaled(scaled: number): string {
  const whole = Math.trunc(scaled / SCALE);
  const fraction = scaled % SCALE;
  if (fraction === 0) {
    return String(whole);
  }
  const fractionDigits = String(fraction).padStart(DECIMAL_PLACES, "0").replace(/0+$/, "");
  return `${whole}.${fractionDigits}`;
}

/**
 * Validates and normalizes a raw string into a `Percent`: must be greater
 * than 0, at most 100, with up to 4 decimal places. Stores the value
 * exactly as given (e.g. `"33.33"` stays `"33.33"`, no rounding) --
 * `parseScaled`/`formatScaled` are only used to check the range, not to
 * reformat the output.
 */
export function toPercent(raw: string): Percent {
  const trimmed = raw.trim();
  const scaled = parseScaled(trimmed);
  if (scaled <= 0 || scaled > 100 * SCALE) {
    throw new InvalidPercentError(trimmed);
  }
  return trimmed as Percent;
}

/**
 * Decimal-safe addition of `Percent` values via fixed-point integer math
 * (scaled by 10000) -- never `parseFloat`/`Number()` on the values
 * themselves. Returns `"0"` for an empty list (e.g. a Project with no
 * Partner Shares yet). The result is not itself range-checked against
 * `0 < x <= 100` -- a running total can legitimately sit below or above
 * 100% mid-process (see spec-2-2's Decisions), so callers compare/display
 * it themselves.
 */
export function sumPercents(values: readonly Percent[]): Percent {
  const totalScaled = values.reduce((sum, value) => sum + parseScaled(value), 0);
  return formatScaled(totalScaled) as Percent;
}

const MONEY_DECIMAL_PLACES = 2;

/** Thrown by `toMoney` for a value that isn't a non-negative decimal with at most 2 decimal places. */
export class InvalidMoneyError extends Error {
  constructor(raw: string) {
    super(`"${raw}" is not a valid Money amount -- must be non-negative, with up to 2 decimal places.`);
    this.name = "InvalidMoneyError";
  }
}

/**
 * Parses a plain decimal string into an integer scaled by 100 (2 decimal
 * places), using only string/digit arithmetic -- never `parseFloat`/
 * `Number()` -- so the result is exact for any input with up to 2
 * fractional digits. Unlike `parseScaled` (Percent, capped at 3 whole-number
 * digits since a valid Percent is always <= 100), `Money` has no
 * business-rule upper bound -- but the whole-number part is still capped at
 * 12 digits (`\d{1,12}`), matching `investment_requirements.amount`'s
 * declared `numeric(14,2)` column precision (14 total digits - 2 decimal
 * places = 12 whole-number digits). Without this cap, a 13+-digit amount
 * would pass every app-layer check and crash uncaught at the Postgres
 * insert instead of failing cleanly with `InvalidMoneyError`/400
 * `validation_error` like every other invalid amount. Throws
 * `InvalidMoneyError` for anything that isn't a bare, non-negative decimal
 * (no sign, no exponent, no thousands separators, at most 2 fractional
 * digits) -- this is also how a negative-looking string (e.g. `"-500"`) is
 * rejected, since the pattern has no sign alternative at all.
 */
function parseMoneyScaled(raw: string): number {
  // Both quantified groups are bounded to matching a run of digits with no
  // overlap (the second only ever matches after a literal `.`, capped at 2
  // digits) -- linear-time, no catastrophic backtracking; `safe-regex`'s
  // heuristic just flags any two quantified groups in one pattern.
  // eslint-disable-next-line security/detect-unsafe-regex
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) {
    throw new InvalidMoneyError(raw);
  }
  const [, wholePart, fractionPart = ""] = match;
  const paddedFraction = fractionPart.padEnd(MONEY_DECIMAL_PLACES, "0");
  return digitsToInt(wholePart) * 10 ** MONEY_DECIMAL_PLACES + digitsToInt(paddedFraction);
}

/**
 * Validates and normalizes a raw string into a `Money`: non-negative, with
 * up to 2 decimal places, no upper bound. Stores the value exactly as given
 * (e.g. `"1000000"` stays `"1000000"`, no rounding/reformatting) --
 * `parseMoneyScaled` is only used to check the format, not to reformat the
 * output. The stricter `> 0` check a funding requirement needs is
 * deliberately not baked in here -- see this story's Decisions -- callers
 * needing that enforce it themselves on top of this type's validation.
 */
export function toMoney(raw: string): Money {
  const trimmed = raw.trim();
  parseMoneyScaled(trimmed);
  return trimmed as Money;
}

/** `true` if `value` is exactly zero (e.g. `"0"`, `"0.0"`, `"0.00"`), decimal-safe -- never a `parseFloat`/`Number()` comparison. */
export function isZeroMoney(value: Money): boolean {
  return parseMoneyScaled(value) === 0;
}
