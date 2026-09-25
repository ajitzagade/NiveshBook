import { describe, it, expect } from "vitest";
import type { Money } from "@niveshbook/types";
import { assertSufficientBalance, InsufficientAvailableBalanceError } from "./available-balance";

describe("assertSufficientBalance (Story 4.9, FR29, AD-10)", () => {
  it("does not throw when spendAmount is strictly less than currentBalance", () => {
    expect(() => assertSufficientBalance("50000" as Money, "30000" as Money)).not.toThrow();
  });

  it("does not throw when spendAmount exactly equals currentBalance (spending the whole balance is valid)", () => {
    expect(() => assertSufficientBalance("50000" as Money, "50000" as Money)).not.toThrow();
  });

  it("does not throw for a decimal-scale-only difference (Postgres numeric(14,2) round-trip, AD-2)", () => {
    expect(() => assertSufficientBalance("50000.00" as Money, "50000" as Money)).not.toThrow();
  });

  it("throws InsufficientAvailableBalanceError when spendAmount exceeds currentBalance (AC3)", () => {
    expect(() => assertSufficientBalance("20000" as Money, "30000" as Money)).toThrow(
      InsufficientAvailableBalanceError,
    );
  });

  it("throws for a spend against a zero balance", () => {
    expect(() => assertSufficientBalance("0" as Money, "1" as Money)).toThrow(
      InsufficientAvailableBalanceError,
    );
  });

  it("does not throw for a zero-amount spend against a zero balance", () => {
    expect(() => assertSufficientBalance("0" as Money, "0" as Money)).not.toThrow();
  });
});
