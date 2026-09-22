import type { Portfolio, Investment } from "@niveshbook/types";

export function totalInvestedValue(portfolio: Portfolio): number {
  return portfolio.investments.reduce((sum, inv) => sum + inv.investedValue.amount, 0);
}

export function totalCurrentValue(portfolio: Portfolio): number {
  return portfolio.investments.reduce((sum, inv) => sum + inv.currentValue.amount, 0);
}

export function absoluteReturn(portfolio: Portfolio): number {
  return totalCurrentValue(portfolio) - totalInvestedValue(portfolio);
}

export function absoluteReturnPercent(portfolio: Portfolio): number {
  const invested = totalInvestedValue(portfolio);
  if (invested === 0) return 0;
  return (absoluteReturn(portfolio) / invested) * 100;
}

export function investmentReturn(investment: Investment): number {
  return investment.currentValue.amount - investment.investedValue.amount;
}
