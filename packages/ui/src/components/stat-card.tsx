import type { ReactNode } from "react";
import { Amount, toneClass, type AmountTone } from "./amount";
import { cn } from "../lib/cn";
import { TONE_ICON_CLASS, type Tone } from "../lib/tone";

export interface StatCardProps {
  label: string;
  value: string | number;
  tone?: AmountTone;
  /** "count" for a plain number (e.g. Total Projects) -- most stat cards are money. */
  format?: "money" | "count";
  /** Optional icon rendered in a tinted circle above the label -- omitted (default) renders byte-for-byte as before this prop existed. */
  icon?: ReactNode;
  iconTone?: Tone;
  className?: string;
}

export function StatCard({
  label,
  value,
  tone = "default",
  format = "money",
  icon,
  iconTone = "neutral",
  className,
}: StatCardProps) {
  return (
    <div className={cn("nb-card px-[15px] pt-[15px] pb-[13px]", className)}>
      {icon ? (
        <span
          // eslint-disable-next-line security/detect-object-injection -- iconTone is a TS union type, not an arbitrary string
          className={cn("mb-2 flex h-7 w-7 items-center justify-center rounded-full", TONE_ICON_CLASS[iconTone])}
        >
          {icon}
        </span>
      ) : null}
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
