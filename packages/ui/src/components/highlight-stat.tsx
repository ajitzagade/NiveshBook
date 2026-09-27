import type { ReactNode } from "react";
import { Amount } from "./amount";
import { cn } from "../lib/cn";
import { TONE_BORDER_CLASS, TONE_ICON_CLASS, TONE_SOFT_BG_CLASS, type Tone } from "../lib/tone";

export type HighlightStatTone = Extract<Tone, "amber" | "success" | "accent">;

export interface HighlightStatProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  tone: HighlightStatTone;
  className?: string;
}

/**
 * The Partner/Sub-partner dashboard's Pending to Pay / Extra Paid / Keep for
 * Later cards -- a tinted border + soft background wash, icon+label header,
 * bold amount below. Unlike a plain `StatCard`, the whole card carries the
 * tone (not just the value), so it reads at a glance as a callout, not just
 * another number in a grid.
 */
export function HighlightStat({ icon, label, value, tone, className }: HighlightStatProps) {
  return (
    <div
      className={cn(
        "rounded-card border px-[15px] pt-[15px] pb-[13px]",
        // eslint-disable-next-line security/detect-object-injection -- tone is a TS union type, not an arbitrary string
        TONE_BORDER_CLASS[tone],
        // eslint-disable-next-line security/detect-object-injection -- tone is a TS union type, not an arbitrary string
        TONE_SOFT_BG_CLASS[tone],
        className,
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          // eslint-disable-next-line security/detect-object-injection -- tone is a TS union type, not an arbitrary string
          className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", TONE_ICON_CLASS[tone])}
        >
          {icon}
        </span>
        <span className="text-[11.6px] font-semibold text-ink-soft">{label}</span>
      </div>
      <Amount value={value} size="lg" />
    </div>
  );
}
