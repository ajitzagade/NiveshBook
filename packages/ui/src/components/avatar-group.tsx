import { cn } from "../lib/cn";

export interface AvatarGroupItem {
  id: string;
  initials: string;
}

export interface AvatarGroupProps {
  items: AvatarGroupItem[];
  /** Caps how many circles render before collapsing the rest into a "+N" circle. Default 4. */
  max?: number;
  className?: string;
}

/** A small stack of overlapping dark-navy initials circles, e.g. a ProjectPreviewCard's own-avatar slot. */
export function AvatarGroup({ items, max = 4, className }: AvatarGroupProps) {
  const visible = items.slice(0, max);
  const overflow = items.length - visible.length;

  return (
    <div className={cn("flex items-center", className)}>
      {visible.map((item, index) => (
        <span
          key={item.id}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-surface bg-ink text-[10px] font-bold text-white",
            index > 0 && "-ml-2",
          )}
        >
          {item.initials}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="-ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-surface bg-surface-alt text-[10px] font-bold text-ink-soft">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
