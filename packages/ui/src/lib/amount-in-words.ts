const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    const tens = TENS[Math.floor(n / 10)];
    const ones = n % 10;
    // eslint-disable-next-line security/detect-object-injection -- ones is bounded to 0-9 by n % 10
    parts.push(ones ? `${tens} ${ONES[ones]}` : tens);
  } else if (n > 0) {
    // eslint-disable-next-line security/detect-object-injection -- n is bounded to 0-19 by the preceding checks
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

/**
 * Indian-numbering (lakh/crore) words for the integer rupee part of an
 * amount -- e.g. `"1000000"` -> `"Ten Lakh"`, `"1234567"` -> `"Twelve Lakh
 * Thirty Four Thousand Five Hundred Sixty Seven"`. Paise aren't spelled out
 * -- `formatAmount` already shows them numerically. Returns `null` for
 * empty, zero, negative, or non-numeric input, so callers can skip the
 * parenthetical entirely rather than show a degenerate "(Zero)"/"()".
 */
export function amountInWords(value: string | number): string | null {
  const raw = typeof value === "number" ? value.toString() : value.trim();
  if (!raw) return null;
  const intPart = raw.split(".")[0];
  if (!/^\d+$/.test(intPart)) return null;
  const n = Number(intPart);
  if (!Number.isFinite(n) || n <= 0 || n > Number.MAX_SAFE_INTEGER) return null;

  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1_000);
  const hundreds = n % 1_000;

  const segments: string[] = [];
  if (crore > 0) segments.push(`${belowThousand(crore)} Crore`);
  if (lakh > 0) segments.push(`${belowThousand(lakh)} Lakh`);
  if (thousand > 0) segments.push(`${belowThousand(thousand)} Thousand`);
  if (hundreds > 0) segments.push(belowThousand(hundreds));

  return segments.join(" ") || null;
}
