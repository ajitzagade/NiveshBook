import { describe, it, expect } from "vitest";
import { amountInWords } from "./amount-in-words";

describe("amountInWords", () => {
  it("renders a round lakh amount", () => {
    expect(amountInWords("1000000")).toBe("Ten Lakh");
  });

  it("renders a round thousand amount", () => {
    expect(amountInWords("50000")).toBe("Fifty Thousand");
  });

  it("renders a mixed crore/lakh/thousand/hundred amount", () => {
    expect(amountInWords("1234567")).toBe("Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven");
  });

  it("renders a single crore", () => {
    expect(amountInWords("10000000")).toBe("One Crore");
  });

  it("renders a small amount under a thousand", () => {
    expect(amountInWords("999")).toBe("Nine Hundred Ninety Nine");
  });

  it("renders an amount under a hundred", () => {
    expect(amountInWords("42")).toBe("Forty Two");
  });

  it("ignores the decimal/paise portion", () => {
    expect(amountInWords("1500.75")).toBe("One Thousand Five Hundred");
  });

  it("accepts a number input", () => {
    expect(amountInWords(1000000)).toBe("Ten Lakh");
  });

  it("returns null for empty input", () => {
    expect(amountInWords("")).toBeNull();
  });

  it("returns null for zero", () => {
    expect(amountInWords("0")).toBeNull();
  });

  it("returns null for a negative amount", () => {
    expect(amountInWords("-500")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(amountInWords("abc")).toBeNull();
  });
});
