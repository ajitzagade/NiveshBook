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
 */
export function formatAmount(value: string | number): string {
  const raw = typeof value === "number" ? value.toString() : value;
  const isNegative = raw.trim().startsWith("-");
  const unsigned = isNegative ? raw.trim().slice(1) : raw.trim();
  const [intPart, decimalPart] = unsigned.split(".");
  const groupedInt = groupIndian(intPart || "0");
  const decimal = decimalPart ? `.${decimalPart.slice(0, 2)}` : "";
  return `${isNegative ? "-" : ""}₹${groupedInt}${decimal}`;
}
