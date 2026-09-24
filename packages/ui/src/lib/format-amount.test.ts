import { describe, it, expect } from "vitest";
import { formatAmount } from "./format-amount";

describe("formatAmount", () => {
  it("groups digits Indian-style", () => {
    expect(formatAmount("1000000")).toBe("₹10,00,000");
  });

  it("drops an all-zero decimal portion (Postgres numeric(_, 2) round-trip of a whole-rupee amount)", () => {
    expect(formatAmount("1000000.00")).toBe("₹10,00,000");
  });

  it("keeps a non-zero decimal portion, unpadded/untrimmed", () => {
    expect(formatAmount("1000000.50")).toBe("₹10,00,000.50");
  });

  it("keeps a decimal portion with a trailing zero after a non-zero digit (e.g. paise = 10)", () => {
    expect(formatAmount("1000000.10")).toBe("₹10,00,000.10");
  });

  it("renders a negative amount with the sign before the ₹ symbol", () => {
    expect(formatAmount("-500")).toBe("-₹500");
  });

  it("drops an all-zero decimal portion on a negative amount too", () => {
    expect(formatAmount("-500.00")).toBe("-₹500");
  });

  it("accepts a number input", () => {
    expect(formatAmount(1000000)).toBe("₹10,00,000");
  });
});
