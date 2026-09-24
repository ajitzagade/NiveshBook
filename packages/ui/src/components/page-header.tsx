import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "../lib/cn";

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Plain `<a>`, matching `NavItem`'s own convention -- packages/ui stays framework-agnostic (no next/link). */
  backHref?: string;
  backLabel?: string;
  /** Right-aligned primary action(s) -- typically a `Button` (or `Button asChild` wrapping a `next/link` `Link`, supplied by the caller). */
  action?: ReactNode;
  className?: string;
}

/**
 * The page-level header shape every real screen already used independently
 * (Projects, Partner Shares, Add Money, Edit Project): an optional back
 * link, a title, a description, and a right-aligned primary action.
 * Centralized here so every module's header stays pixel-for-pixel
 * consistent instead of re-implementing the same div/h1/p/button markup
 * per page.
 */
export function PageHeader({
  title,
  description,
  backHref,
  backLabel,
  action,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-start justify-between gap-4", className)}>
      <div>
        {backHref ? (
          <a
            href={backHref}
            className="inline-flex items-center gap-1 text-[12.6px] text-ink-soft hover:underline"
          >
            <ArrowLeft size={12} />
            {backLabel ?? "Back"}
          </a>
        ) : null}
        <h1 className={cn("text-[22px]", backHref ? "mt-1" : undefined)}>{title}</h1>
        {description ? <p className="mt-1 text-[13.4px] text-ink-soft">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2.5">{action}</div> : null}
    </div>
  );
}
