import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { TONE_ICON_CLASS, type Tone } from "../lib/tone";

export interface ActionTileProps {
  icon: ReactNode;
  label: string;
  tone: Tone;
  /** Renders as a plain `<a>` when set (mirrors `NavItem`'s framework-agnostic href convention) -- static, non-interactive tile when omitted. */
  href?: string;
  className?: string;
}

/**
 * The Home page's quick-action row (icon-in-tinted-circle + label). Not a
 * button/StatCard hybrid -- purely a navigational or decorative tile, never
 * carries a value itself.
 */
export function ActionTile({ icon, label, tone, href, className }: ActionTileProps) {
  const rootClassName = cn(
    "nb-card flex items-center gap-3 px-[15px] py-[15px]",
    href && "transition-colors hover:bg-surface-alt",
    className,
  );
  const content = (
    <>
      <span
        // eslint-disable-next-line security/detect-object-injection -- tone is a TS union type, not an arbitrary string
        className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", TONE_ICON_CLASS[tone])}
      >
        {icon}
      </span>
      <span className="text-[13.4px] font-semibold text-ink">{label}</span>
    </>
  );

  if (href) {
    return (
      <a href={href} className={rootClassName}>
        {content}
      </a>
    );
  }

  return <div className={rootClassName}>{content}</div>;
}
