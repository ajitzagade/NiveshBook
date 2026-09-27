import { ChevronRight } from "lucide-react";
import { Amount } from "./amount";
import { AvatarGroup } from "./avatar-group";
import { Card } from "./card";
import { cn } from "../lib/cn";

export interface ProjectPreviewCardProps {
  name: string;
  description?: string | null;
  /** Chevron-link target (e.g. the actor's own Structure view) -- omitted renders no chevron rather than a dead affordance. */
  href?: string;
  /** The actor's OWN initials only -- a Partner/Sub-partner dashboard never lists every other partner on the project (see `project-preview-card`'s callers). */
  avatarInitials: string;
  sharePercentLabel: string;
  added: string | number;
  balance: string | number;
  className?: string;
}

/**
 * The Home page's "My Projects" card for the Partner/Sub-partner dashboards:
 * name + description, the actor's own avatar + Share %, and Added/Balance
 * mini-stats. Deliberately narrower than the Bolt mockup this mirrors --
 * no all-partner avatar roster or partner/sub-partner headcounts, since
 * those roles only ever see their own numbers.
 */
export function ProjectPreviewCard({
  name,
  description,
  href,
  avatarInitials,
  sharePercentLabel,
  added,
  balance,
  className,
}: ProjectPreviewCardProps) {
  return (
    <Card elevated className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[14.5px] font-bold">{name}</div>
          {description ? <div className="mt-0.5 truncate text-[12.6px] text-ink-soft">{description}</div> : null}
        </div>
        {href ? (
          <a href={href} aria-label={`View ${name}'s structure`} className="shrink-0 text-ink-faint hover:text-ink-soft">
            <ChevronRight size={16} />
          </a>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <AvatarGroup items={[{ id: name, initials: avatarInitials }]} />
        <span className="font-mono text-[12.8px] tabular-nums text-ink-soft">{sharePercentLabel}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-el bg-success-soft px-3 py-2">
          <div className="text-[10.6px] font-bold uppercase tracking-wide text-success">Added</div>
          <Amount value={added} size="sm" />
        </div>
        <div className="rounded-el bg-amber-soft px-3 py-2">
          <div className="text-[10.6px] font-bold uppercase tracking-wide text-amber">Balance</div>
          <Amount value={balance} size="sm" />
        </div>
      </div>
    </Card>
  );
}
