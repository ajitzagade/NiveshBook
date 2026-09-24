import { describe, it, expect } from "vitest";
import type { Money, Percent } from "@niveshbook/types";
import {
  toPercent,
  sumPercents,
  InvalidPercentError,
  toMoney,
  isZeroMoney,
  InvalidMoneyError,
  sumMoney,
  subtractPercents,
  NegativePercentResultError,
  splitMoneyByPercents,
  SplitPercentTotalError,
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

describe("sumMoney", () => {
  it("sums three amounts exactly", () => {
    const values = ["500000", "300000", "200000"].map(toMoney);
    expect(sumMoney(values)).toBe("1000000");
  });

  it("sums decimal (paise) amounts exactly, no float drift", () => {
    const values = ["0.10", "0.20"].map(toMoney);
    // Naive float addition (0.1 + 0.2) drifts to 0.30000000000000004 --
    // decimal-safe addition must not.
    expect(sumMoney(values)).toBe("0.3");
  });

  it("returns 0 for an empty list", () => {
    expect(sumMoney([])).toBe("0");
  });

  it("returns the single value for a one-element list, trailing fractional zeros trimmed (mirrors sumPercents' formatting)", () => {
    expect(sumMoney([toMoney("1000000.50")])).toBe("1000000.5");
  });
});

describe("subtractPercents", () => {
  it("subtracts exactly, no float drift", () => {
    expect(subtractPercents(toPercent("50"), toPercent("25"))).toBe("25");
  });

  it("subtracts decimal percents exactly", () => {
    expect(subtractPercents(toPercent("50"), toPercent("33.33"))).toBe("16.67");
  });

  it("returns exactly 0 when the subtrahend equals the minuend (fully-suballocated retained percent)", () => {
    expect(subtractPercents(toPercent("50"), toPercent("50"))).toBe("0");
  });

  it("throws NegativePercentResultError when the result would be negative", () => {
    expect(() => subtractPercents(toPercent("50"), toPercent("60"))).toThrow(
      NegativePercentResultError,
    );
  });
});

describe("splitMoneyByPercents", () => {
  it("splits an even 3-way percent split exactly (AC1)", () => {
    const amount = toMoney("1000000");
    const percents = ["50", "30", "20"].map(toPercent);

    const result = splitMoneyByPercents(amount, percents);

    expect(result).toEqual(["500000", "300000", "200000"]);
  });

  it("splits an uneven percent list (33.33/33.33/33.34) via largest-remainder, summing exactly to the amount", () => {
    const amount = toMoney("1000000");
    const percents = ["33.33", "33.33", "33.34"].map(toPercent);

    const result = splitMoneyByPercents(amount, percents);

    expect(sumMoney(result)).toBe("1000000");
    // Each share is close to a third but not necessarily identical --
    // the point is the sum reconciles exactly, not that each divides evenly.
    for (const share of result) {
      expect(Number(share)).toBeGreaterThan(0);
    }
  });

  it("distributes leftover paise to the largest remainders first (classic 100/3 case)", () => {
    const amount = toMoney("100");
    const percents = ["33.33", "33.33", "33.34"].map(toPercent);

    const result = splitMoneyByPercents(amount, percents);

    expect(sumMoney(result)).toBe("100");
    expect(result).toEqual(["33.33", "33.33", "33.34"]);
  });

  it("breaks a tied remainder deterministically by ascending original index", () => {
    // A single leftover paisa (₹0.01), split 50/50: both entries floor to 0
    // with an identical remainder -- only one paisa exists to distribute, so
    // the first entry (index 0) must get it, every time, not entry 1.
    const amount = toMoney("0.01");
    const percents = ["50", "50"].map(toPercent);

    const result = splitMoneyByPercents(amount, percents);

    expect(result).toEqual(["0.01", "0"]);
  });

  it("is deterministic across repeated calls with the same tied input", () => {
    const amount = toMoney("0.01");
    const percents = ["50", "50"].map(toPercent);

    const first = splitMoneyByPercents(amount, percents);
    const second = splitMoneyByPercents(amount, percents);

    expect(first).toEqual(second);
  });

  it("handles a single 100% entry -- the whole amount, no split needed", () => {
    const amount = toMoney("1000000");
    expect(splitMoneyByPercents(amount, [toPercent("100")])).toEqual(["1000000"]);
  });

  it("handles a zero-percent leaf entry -- gets exactly 0, never a stray paisa", () => {
    // A retained percent of exactly "0" isn't producible via `toPercent`
    // (which requires > 0) -- `should-pay.ts` casts it directly for a
    // fully-suballocated Partner, mirroring `sumPercents`'s own
    // over/under-100 output convention. Simulate that cast here.
    const amount = toMoney("1000000");
    const zeroPercent = "0" as Percent;

    const result = splitMoneyByPercents(amount, [toPercent("100"), zeroPercent]);

    expect(result).toEqual(["1000000", "0"]);
  });

  it("throws SplitPercentTotalError when the percents don't sum to exactly 100 (under)", () => {
    const amount = toMoney("1000000");
    const percents = ["50", "30"].map(toPercent);

    expect(() => splitMoneyByPercents(amount, percents)).toThrow(SplitPercentTotalError);
  });

  it("throws SplitPercentTotalError when the percents don't sum to exactly 100 (over)", () => {
    const amount = toMoney("1000000");
    const percents = ["60", "50"].map(toPercent);

    expect(() => splitMoneyByPercents(amount, percents)).toThrow(SplitPercentTotalError);
  });

  it("BigInt is load-bearing: a plain-Number equivalent of this algorithm allocates the leftover paisa to the wrong entry at this scale (regression guard against 'simplifying' BigInt back to Number)", () => {
    // Hand-verified (spec-3-2's Review Triage Log, row 4): at Money's own
    // 12-digit cap, a `Number`-arithmetic reimplementation of this exact
    // largest-remainder algorithm (same floor/remainder/redistribution
    // logic, just `amountScaled * percentScaled` computed as a plain
    // `Number` instead of `BigInt`) still sums to the correct total -- but
    // silently redistributes the leftover paisa to a *different* entry than
    // the exact computation, because precision loss in the product flips
    // two entries' remainder ordering. This is the case the codebase's
    // existing 12-digit test (below) does NOT catch, since that particular
    // input happens to floor identically either way.
    const amount = toMoney("999999999999");
    const percents = ["0.0001", "0.5", "99.4999"].map(toPercent); // sums to exactly 100.0000

    const MONEY_SCALE = 100;
    const PERCENT_SCALE = 10000;
    const denominator = 100 * PERCENT_SCALE;

    function naiveNumberSplit(amountStr: string, percentStrs: string[]): string[] {
      const amountScaled = Math.round(Number(amountStr) * MONEY_SCALE);
      const entries = percentStrs.map((percent, index) => {
        const percentScaled = Math.round(Number(percent) * PERCENT_SCALE);
        const numerator = amountScaled * percentScaled; // plain Number, unlike the real implementation
        return { index, share: Math.floor(numerator / denominator), remainder: numerator % denominator };
      });
      const allocated = entries.reduce((sum, entry) => sum + entry.share, 0);
      let leftover = amountScaled - allocated;
      const byRemainderDesc = [...entries].sort((a, b) =>
        a.remainder === b.remainder ? a.index - b.index : b.remainder - a.remainder,
      );
      const shares = entries.map((entry) => entry.share);
      for (const entry of byRemainderDesc) {
        if (leftover <= 0) break;
        shares[entry.index] = (shares[entry.index] ?? 0) + 1;
        leftover -= 1;
      }
      return shares.map((scaled) => String(scaled));
    }

    const actual = splitMoneyByPercents(amount, percents);
    const naiveScaled = naiveNumberSplit(amount, percents);

    // The real (BigInt) implementation's middle and last entries, scaled by
    // 100 back to an integer, for comparison against the naive computation
    // above (which works in the same scaled-integer space).
    const actualScaled = actual.map((value) => Math.round(Number(value) * MONEY_SCALE).toString());

    // Both "sum correctly" to the total -- proving this isn't merely a
    // gross/obvious error a basic sum-check would already catch.
    expect(sumMoney(actual)).toBe("999999999999");

    // But the real implementation and the plain-Number equivalent disagree
    // on which entries received the leftover paisa -- the middle and last
    // entries land on different values.
    expect(actualScaled).not.toEqual(naiveScaled);
    expect(actual).toEqual(["1000000", "4999999999.99", "994998999999.01"]);
    expect(naiveScaled).toEqual(["100000000", "500000000000", "99499899999900"]);
  });

  it("handles a large amount without precision loss (BigInt, not Number, for the amount*percent product)", () => {
    // 999999999999 (Money's own 12-digit cap) * 33.3333% would exceed
    // Number.MAX_SAFE_INTEGER as a plain product if computed via Number.
    const amount = toMoney("999999999999");
    const percents = ["33.3333", "33.3333", "33.3334"].map(toPercent);

    const result = splitMoneyByPercents(amount, percents);

    expect(sumMoney(result)).toBe("999999999999");
  });
});
