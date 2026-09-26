"use client";

import { useEffect, useState } from "react";
import { LayoutGrid } from "lucide-react";
import {
  Amount,
  Card,
  EmptyState,
  PageHeader,
  StatusChip,
  Table,
  TableBody,
  TableHead,
  TableRow,
  Td,
  Th,
  type StatusChipVariant,
} from "@niveshbook/ui";
import { getMyInvestments, type MyInvestmentEntry } from "@/lib/my-investments";

type MyInvestmentsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; entries: MyInvestmentEntry[] };

/** Reused VERBATIM from `add-money/page.tsx`'s `AdjustmentChip` labels (Story 3.4) -- never reworded. */
const ADJUSTMENT_LABEL: Record<"pending" | "extra_paid" | "none", string> = {
  extra_paid: "Extra Paid",
  pending: "Pending",
  none: "No Adjustment",
};
const ADJUSTMENT_VARIANT: Record<"pending" | "extra_paid" | "none", StatusChipVariant> = {
  extra_paid: "success",
  pending: "danger",
  none: "neutral",
};

const ROLE_LABEL: Record<MyInvestmentEntry["role"], string> = {
  partner: "Partner",
  sub_partner: "Sub-partner",
};

/**
 * Postgres's `numeric(7,4)` always round-trips at full scale ("60" stores
 * back as "60.0000") -- trims trailing fractional zeros for display only,
 * duplicated locally per `apps/web`'s established per-module local-helper
 * convention for this exact function (`home/page.tsx`, `shares/page.tsx`, ...).
 */
function formatSharePercent(raw: string): string {
  if (!raw.includes(".")) {
    return raw;
  }
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * All Investments (founder feedback 2026-09-26) -- the actor's own
 * cross-project view: per Project where they hold a current Partner or
 * Sub-partner Share, their role, share %, and per-requirement own status
 * (should-pay, paid, pending/extra, recommended). Reached from the Projects
 * dropdown's "All Investments" entry (`ProjectSwitcher`) or the `/all-investments`
 * URL directly. All scoping happens server-side (`GET /api/my-investments`'s
 * `authorizeScope` + `assembleMyInvestments` -- owner_admin sees every
 * project/party; anyone else only their own slice, FR10); this page renders
 * whatever slice it's given, never inferring visibility client-side.
 */
export default function AllInvestmentsPage() {
  const [state, setState] = useState<MyInvestmentsState>({ status: "loading" });

  useEffect(() => {
    // Async IIFE satisfies `react-hooks/set-state-in-effect`, mirroring
    // `money-history/page.tsx`'s identical precedent.
    void (async () => {
      try {
        const result = await getMyInvestments();
        setState({ status: "loaded", entries: result.entries });
      } catch (error) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Something went wrong.",
        });
      }
    })();
  }, []);

  return (
    <div>
      <PageHeader
        title="All Investments"
        description="Every Project you hold a share in — your role, share %, and your own status per funding requirement."
      />

      {state.status === "loading" ? (
        <Card>
          <p className="text-[13.4px] text-ink-soft">Loading All Investments…</p>
        </Card>
      ) : state.status === "error" ? (
        <Card>
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        </Card>
      ) : state.entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={<LayoutGrid size={22} />}
            title="No investments yet"
            description="Once you're linked to a Project's Partner or Sub-partner Share, it'll show up here."
          />
        </Card>
      ) : (
        state.entries.map((entry) => (
          <Card key={`${entry.role}:${entry.shareId}:${entry.projectId}`} className="mb-5 last:mb-0">
            <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
              <h2 className="text-[15px] font-bold">{entry.projectName}</h2>
              <StatusChip variant={entry.role === "partner" ? "info" : "violet"}>
                {ROLE_LABEL[entry.role]}
              </StatusChip>
              <span className="font-mono text-[13.4px] tabular-nums text-ink-soft">
                {formatSharePercent(entry.sharePercent)}%
              </span>
              <span className="text-[12.6px] text-ink-faint">{entry.name}</span>
            </div>

            {entry.requirements.length === 0 ? (
              <p className="text-[12.8px] text-ink-soft">No funding requirements on this Project yet.</p>
            ) : (
              <Table>
                <TableHead>
                  <tr>
                    <Th>Requirement Date</Th>
                    <Th>Requirement Amount</Th>
                    <Th>My Should Pay</Th>
                    <Th>Paid</Th>
                    <Th className="!text-left">Status</Th>
                    <Th>Recommended</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {entry.requirements.map((requirement) => (
                    <TableRow key={requirement.requirementId}>
                      <Td className="!text-left">{requirement.requirementDate}</Td>
                      <Td>
                        <Amount value={requirement.requirementAmount} size="sm" />
                      </Td>
                      {requirement.status ? (
                        <>
                          <Td>
                            <Amount value={requirement.status.shouldPay} size="sm" />
                          </Td>
                          <Td>
                            <Amount value={requirement.status.actualPaid} size="sm" />
                          </Td>
                          <Td className="!text-left">
                            <StatusChip variant={ADJUSTMENT_VARIANT[requirement.status.adjustmentType]}>
                              {ADJUSTMENT_LABEL[requirement.status.adjustmentType]}
                              {requirement.status.adjustmentType !== "none" ? (
                                <>
                                  {" "}
                                  <Amount value={requirement.status.adjustmentAmount} size="sm" />
                                </>
                              ) : null}
                            </StatusChip>
                          </Td>
                          <Td>
                            {requirement.status.recommendedAmount ? (
                              <Amount value={requirement.status.recommendedAmount} size="sm" />
                            ) : (
                              <span className="text-ink-faint">—</span>
                            )}
                          </Td>
                        </>
                      ) : (
                        <Td colSpan={4} className="!text-left text-ink-soft">
                          Not computable yet — this Project&apos;s shares aren&apos;t fully allocated.
                        </Td>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
