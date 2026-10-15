const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * The one `dd-mm-yyyy` date format every user-facing date in the app should
 * use instead of a raw ISO string or a locale-dependent `toLocaleDateString()`
 * call.
 *
 * A bare `"YYYY-MM-DD"` (no time component, e.g. a transaction's `date`
 * field) has its year/month/day pulled directly out of the string rather
 * than handed to `new Date(string)` -- that constructor treats a date-only
 * string as UTC midnight, which would otherwise render a day early in any
 * negative-UTC-offset timezone. A `Date` object (or a full ISO timestamp
 * string) instead has its *local* year/month/day read off directly, so a
 * timestamp already in the viewer's local time renders correctly.
 */
export function formatDate(value: string | Date): string {
  let year: number;
  let month: number;
  let day: number;
  if (typeof value === "string" && DATE_ONLY_PATTERN.test(value)) {
    [year, month, day] = value.split("-").map(Number);
  } else {
    const date = typeof value === "string" ? new Date(value) : value;
    year = date.getFullYear();
    month = date.getMonth() + 1;
    day = date.getDate();
  }
  return `${pad2(day)}-${pad2(month)}-${year}`;
}

/**
 * `dd-mm-yyyy, h:mm am/pm` date+time formatting, for timestamps (e.g. audit
 * log entries) where the time of day matters, not just the day.
 */
export function formatDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const datePart = formatDate(date);
  const timePart = date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${datePart}, ${timePart}`;
}
