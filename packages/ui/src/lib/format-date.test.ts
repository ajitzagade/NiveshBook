import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime } from "./format-date";

describe("formatDate", () => {
  it("renders a zero-padded dd-mm-yyyy date", () => {
    expect(formatDate(new Date(2026, 8, 27))).toBe("27-09-2026");
  });

  it("zero-pads a single-digit day and month", () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe("05-01-2026");
  });

  it("accepts an ISO date string", () => {
    expect(formatDate(new Date(2026, 8, 27).toISOString())).toBe(formatDate(new Date(2026, 8, 27)));
  });

  it("treats a bare YYYY-MM-DD string as its own local calendar date, not UTC midnight", () => {
    expect(formatDate("2026-09-27")).toBe("27-09-2026");
  });
});

describe("formatDateTime", () => {
  it("renders a dd-mm-yyyy date plus a 12-hour time", () => {
    const result = formatDateTime(new Date(2026, 8, 27, 15, 41));
    expect(result).toBe("27-09-2026, 3:41 pm");
  });
});
