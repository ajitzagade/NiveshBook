import type { ReactNode } from "react";

export interface DistributedCheckProps {
  label: string;
  status: ReactNode;
}

/**
 * The running-total bar used by both Partner Shares (FR-13, "100% ✓") and
 * Withdrawal Destination split (FR-27, "Distributed: ₹X / ₹Y ✓"). Pair with
 * disabling the form's save/next action until the two amounts match exactly.
 */
export function DistributedCheck({ label, status }: DistributedCheckProps) {
  return (
    <div className="nb-distributed-check">
      <span>{label}</span>
      <span className="num">{status}</span>
    </div>
  );
}
