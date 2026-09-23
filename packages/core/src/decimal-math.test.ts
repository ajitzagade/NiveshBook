import { describe, it, expect } from "vitest";
import type { Percent } from "@niveshbook/types";
import { toPercent, sumPercents, InvalidPercentError } from "./decimal-math";

describe("toPercent", () => {
  it("accepts a 2-decimal value and stores it exactly, no rounding", () => {
    expect(toPercent("33.33")).toBe("33.33");
  });

  it("accepts a whole number", () => {
    expect(toPercent("50")).toBe("50");
  });

  it("accepts up to 4 decimal places", () => {
    expect(toPercent("33.3333")).toBe("33.3333");
  });

  it("accepts the upper boundary, 100", () => {
    expect(toPercent("100")).toBe("100");
  });

  it("accepts a small value just above 0", () => {
    expect(toPercent("0.0001")).toBe("0.0001");
  });

  it("trims surrounding whitespace", () => {
    expect(toPercent("  33.33  ")).toBe("33.33");
  });

  it.each(["0", "0.0000", "150", "-5", "100.0001", "abc", "", "33.33.33", "1e5", "33,33"])(
    "rejects an out-of-range or malformed value (%j)",
    (raw) => {
      expect(() => toPercent(raw)).toThrow(InvalidPercentError);
    },
  );

  it("rejects more than 4 decimal places", () => {
    expect(() => toPercent("33.33333")).toThrow(InvalidPercentError);
  });
});

describe("sumPercents", () => {
  it("sums three shares to exactly 100 without float drift", () => {
    const values = ["50", "30", "20"].map(toPercent);
    expect(sumPercents(values)).toBe("100");
  });

  it("sums decimal shares exactly (e.g. thirds)", () => {
    const values = ["33.33", "33.33", "33.34"].map(toPercent);
    expect(sumPercents(values)).toBe("100");
  });

  it("computes a partial (under-100) total", () => {
    const values = ["50", "30"].map(toPercent);
    expect(sumPercents(values)).toBe("80");
  });

  it("computes an over-100 total", () => {
    const values = ["60", "50"].map(toPercent);
    expect(sumPercents(values)).toBe("110");
  });

  it("returns 0 for an empty list", () => {
    expect(sumPercents([])).toBe("0");
  });

  it("does not accumulate float drift across many fractional values", () => {
    const values: Percent[] = Array.from({ length: 10 }, () => toPercent("10.1111"));
    // 10 * 10.1111 = 101.111 exactly -- naive float addition of 0.1-style
    // decimals is the classic case that drifts (e.g. 0.1 + 0.2 !== 0.3).
    expect(sumPercents(values)).toBe("101.111");
  });
});
