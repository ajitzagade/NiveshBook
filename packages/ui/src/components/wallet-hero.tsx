import type { ReactNode } from "react";
import { Amount } from "./amount";

export interface WalletHeroProps {
  label: string;
  value: string | number;
  action?: ReactNode;
}

/**
 * The one gradient card in the product (DESIGN.md) -- Available Balance
 * only. Not a reusable "hero" pattern; don't reach for this elsewhere.
 */
export function WalletHero({ label, value, action }: WalletHeroProps) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-card px-[22px] py-5"
      style={{ background: "linear-gradient(135deg, var(--color-accent-soft), var(--color-info-soft))" }}
    >
      <div>
        <div className="text-[11.6px] font-semibold text-accent-strong mb-1.5">{label}</div>
        <Amount value={value} size="hero" className="text-accent-strong" />
      </div>
      {action}
    </div>
  );
}
