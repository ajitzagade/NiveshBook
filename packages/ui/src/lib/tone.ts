/**
 * Shared semantic-tone class maps for the new card-based components
 * (ActionTile, HighlightStat, StatCard's icon slot) -- one source of truth
 * for tone -> Tailwind utility class, so each component doesn't redeclare
 * its own copy of the same `--color-*` token mapping (DRY). Every class
 * resolves to an existing `@theme` token in `tokens.css` -- never a new
 * color family.
 */
export type Tone = "accent" | "success" | "danger" | "info" | "violet" | "amber" | "neutral";

/** Tinted circle background + icon color, e.g. an ActionTile's icon badge or StatCard's optional icon slot. */
export const TONE_ICON_CLASS: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  violet: "bg-violet-soft text-violet",
  amber: "bg-amber-soft text-amber",
  neutral: "bg-surface-alt text-ink-soft",
};

/** Solid tone border, e.g. HighlightStat's outlined card. */
export const TONE_BORDER_CLASS: Record<Tone, string> = {
  accent: "border-accent",
  success: "border-success",
  danger: "border-danger",
  info: "border-info",
  violet: "border-violet",
  amber: "border-amber",
  neutral: "border-border",
};

/** Soft tone background fill only (no text color), e.g. HighlightStat's card wash. */
export const TONE_SOFT_BG_CLASS: Record<Tone, string> = {
  accent: "bg-accent-soft",
  success: "bg-success-soft",
  danger: "bg-danger-soft",
  info: "bg-info-soft",
  violet: "bg-violet-soft",
  amber: "bg-amber-soft",
  neutral: "bg-surface-alt",
};
