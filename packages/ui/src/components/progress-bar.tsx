import { cn } from "../lib/cn";

export type ProgressBarTone = "success" | "accent" | "amber" | "danger";

export interface ProgressBarProps {
  /** Clamped to [0, 100] -- a caller passing an out-of-range Should-Pay ratio never visually overflows the track. */
  percent: number;
  tone?: ProgressBarTone;
  className?: string;
}

const TONE_FILL_CLASS: Record<ProgressBarTone, string> = {
  success: "bg-success",
  accent: "bg-accent",
  amber: "bg-amber",
  danger: "bg-danger",
};

/** Add Money's per-person Should Pay progress indicator -- thin track + fill + trailing %. */
export function ProgressBar({ percent, tone = "success", className }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-1.5 w-full min-w-[48px] overflow-hidden rounded-chip bg-border"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          // eslint-disable-next-line security/detect-object-injection -- tone is a TS union type, not an arbitrary string
          className={cn("h-full rounded-chip", TONE_FILL_CLASS[tone])}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[11.6px] tabular-nums text-ink-soft">{clamped}%</span>
    </div>
  );
}
