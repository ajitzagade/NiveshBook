export interface PortfolioSummaryCardProps {
  name: string;
  currentValue: number;
  returnPercent: number;
  currency?: string;
}

export function PortfolioSummaryCard({
  name,
  currentValue,
  returnPercent,
  currency = "INR",
}: PortfolioSummaryCardProps) {
  const isPositive = returnPercent >= 0;
  return (
    <div style={{ border: "1px solid #e2e2e2", borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 14, color: "#666" }}>{name}</div>
      <div style={{ fontSize: 24, fontWeight: 600 }}>
        {currency} {currentValue.toLocaleString()}
      </div>
      <div style={{ color: isPositive ? "#0a7d2f" : "#c0392b" }}>
        {isPositive ? "+" : ""}
        {returnPercent.toFixed(2)}%
      </div>
    </div>
  );
}
