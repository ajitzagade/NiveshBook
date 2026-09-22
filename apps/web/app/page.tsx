import { PortfolioSummaryCard } from "@niveshbook/ui";
import { absoluteReturnPercent, totalCurrentValue } from "@niveshbook/core";
import type { Portfolio } from "@niveshbook/types";

const demoPortfolio: Portfolio = {
  id: "demo",
  ownerId: "demo-user",
  name: "Demo Portfolio",
  investments: [
    {
      id: "inv-1",
      name: "Nifty 50 Index Fund",
      category: "mutual_fund",
      investedValue: { amount: 100000, currency: "INR" },
      currentValue: { amount: 118500, currency: "INR" },
      purchaseDate: "2024-01-15",
    },
  ],
};

export default function HomePage() {
  return (
    <main style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <h1>NiveshBook</h1>
      <PortfolioSummaryCard
        name={demoPortfolio.name}
        currentValue={totalCurrentValue(demoPortfolio)}
        returnPercent={absoluteReturnPercent(demoPortfolio)}
      />
    </main>
  );
}
