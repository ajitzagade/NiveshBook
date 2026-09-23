import { Amount, toneClass, type AmountTone } from "./amount";
import { cn } from "../lib/cn";

export interface StatCardProps {
  label: string;
  value: string | number;
  tone?: AmountTone;
  /** "count" for a plain number (e.g. Total Projects) -- most stat cards are money. */
  format?: "money" | "count";
  className?: string;
}

export function StatCard({ label, value, tone = "default", format = "money", className }: StatCardProps) {
  return (
    <div className={cn("nb-card px-[15px] pt-[15px] pb-[13px]", className)}>
      <div className="text-[11.6px] font-semibold text-ink-faint mb-1.5">{label}</div>
      {format === "money" ? (
        <Amount value={value} tone={tone} size="lg" />
      ) : (
        // eslint-disable-next-line security/detect-object-injection -- tone is a TS union type, not an arbitrary string
        <span className={cn("num text-[19px] font-bold", toneClass[tone])}>{value}</span>
      )}
    </div>
  );
}
