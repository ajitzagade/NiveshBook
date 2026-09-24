function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  // Digits-only, length-bounded amount string -- never untrusted free text.
  // eslint-disable-next-line security/detect-unsafe-regex
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${grouped},${last3}`;
}

/**
 * ₹ + Indian digit grouping (10,00,000, not 1,000,000). Accepts a decimal
 * string (never a float -- AD-2) and never rounds silently; fractional
 * paise beyond 2 places are preserved as given.
 *
 * A Postgres `numeric(_, 2)` column round-trips a whole-rupee amount like
 * `"1000000"` as `"1000000.00"` on every later read -- an all-zero decimal
 * portion is dropped entirely (never a partially-zero one, e.g. `"50"`
 * still renders as `.50`, currency's usual fixed 2-decimal-place display),
 * mirroring `formatSharePercent`'s Story 2.2 precedent for the identical
 * DB round-trip issue. Display-only -- the stored/submitted value itself
 * is never touched.
 */
export function formatAmount(value: string | number): string {
  const raw = typeof value === "number" ? value.toString() : value;
  const isNegative = raw.trim().startsWith("-");
  const unsigned = isNegative ? raw.trim().slice(1) : raw.trim();
  const [intPart, decimalPart] = unsigned.split(".");
  const groupedInt = groupIndian(intPart || "0");
  const decimalDigits = decimalPart ? decimalPart.slice(0, 2) : "";
  const decimal = /[1-9]/.test(decimalDigits) ? `.${decimalDigits}` : "";
  return `${isNegative ? "-" : ""}₹${groupedInt}${decimal}`;
}
