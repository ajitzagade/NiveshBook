import type { ReactNode } from "react";

/**
 * Outer vertical-stack wrapper -- still used as-is by the Shares/Add
 * Money/Withdraw Money pages to lay out their `PersonCard`s (moved here,
 * split out of the now-deleted `share-row.tsx`, spec-partner-hierarchy-cards
 * review fix: `ShareRow` itself has zero remaining callers now that those
 * pages render `PersonCard`, but `ShareList` is still load-bearing).
 */
export function ShareList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2.5">{children}</div>;
}
