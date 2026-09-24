import { describe, it, expect } from "vitest";
import type { Money, Percent } from "@niveshbook/types";
import {
  toPercent,
  sumPercents,
  InvalidPercentError,
  toMoney,
  isZeroMoney,
  InvalidMoneyError,
} from "./decimal-math";

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

describe("toMoney", () => {
  it("accepts a large whole-number amount, stored exactly, no rounding", () => {
    expect(toMoney("1000000")).toBe("1000000");
  });

  it("accepts a 2-decimal value and stores it exactly", () => {
    expect(toMoney("1000000.50")).toBe("1000000.50");
  });

  it("accepts a single-decimal value", () => {
    expect(toMoney("100.5")).toBe("100.5");
  });

  it("accepts zero -- Money itself has no `> 0` constraint (Story 3.3's Paid Now needs this)", () => {
    expect(toMoney("0")).toBe("0");
  });

  it("has no business-rule upper bound, unlike toPercent's 100 cap -- accepts a 12-digit whole number", () => {
    expect(toMoney("999999999999")).toBe("999999999999");
  });

  it("rejects a 13-digit whole number -- exceeds investment_requirements.amount's numeric(14,2) precision (12 whole-number digits)", () => {
    expect(() => toMoney("1000000000000")).toThrow(InvalidMoneyError);
  });

  it("trims surrounding whitespace", () => {
    expect(toMoney("  1000  ")).toBe("1000");
  });

  it.each(["-500", "abc", "", "100.999", "1,000", "1e5", "33.33.33", ".5"])(
    "rejects a malformed or negative value (%j)",
    (raw) => {
      expect(() => toMoney(raw)).toThrow(InvalidMoneyError);
    },
  );

  it("rejects more than 2 decimal places", () => {
    expect(() => toMoney("1000.999")).toThrow(InvalidMoneyError);
  });
});

describe("isZeroMoney", () => {
  it("returns true for '0'", () => {
    expect(isZeroMoney(toMoney("0"))).toBe(true);
  });

  it.each(["0.0", "0.00"])("returns true for zero written with trailing decimal zeros (%j)", (raw) => {
    expect(isZeroMoney(toMoney(raw))).toBe(true);
  });

  it("returns false for a nonzero amount", () => {
    expect(isZeroMoney(toMoney("1000000") as Money)).toBe(false);
  });

  it("returns false for a small nonzero fractional amount", () => {
    expect(isZeroMoney(toMoney("0.01"))).toBe(false);
  });
});
