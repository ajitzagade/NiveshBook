import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  /** A `lucide-react` icon element, sized by the caller (~22px reads well in the default badge) -- keeps packages/ui icon-library-agnostic, same convention as `NavItem`'s `icon` prop. */
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** Typically a `Button` -- rendered only when there's a real next step to offer. */
  action?: ReactNode;
  className?: string;
}

/**
 * The "nothing here yet" pattern for any list screen (Projects, Partner
 * Shares, Add Money, ...): an icon, a short heading, an optional
 * description, and an optional primary action -- centered with generous
 * padding so it reads as a considered state, not a stray line of text
 * floating in an otherwise-empty Card.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-1.5 py-12 text-center", className)}>
      {icon ? (
        <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-surface-alt text-ink-faint">
          {icon}
        </div>
      ) : null}
      <p className="text-[14.5px] font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-[360px] text-[13px] text-ink-soft">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
