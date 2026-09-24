"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BanknoteArrowDown } from "lucide-react";
import type { PartnerCanTake } from "@niveshbook/core";
import { Amount, Card, DistributedCheck, EmptyState, PageHeader, ShareList, ShareRow } from "@niveshbook/ui";
import { getCanTake } from "@/lib/can-take";

type CanTakeState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; availableToWithdraw: string; partners: PartnerCanTake[] };

/**
 * Postgres's `numeric(7,4)` column always round-trips at its full declared
 * scale (a stored `"33.33"` reads back as `"33.3300"` -- exact, no precision
 * lost, just padded). Trims trailing fractional zeros for display only, via
 * plain string manipulation (no `parseFloat`/`Number()`) -- mirrors the
 * Partner Shares/Add Money pages' identical `formatSharePercent` precedent.
 */
function formatSharePercent(raw: string): string {
  if (!raw.includes(".")) {
    return raw;
  }
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Withdraw Money page (Story 4.1): one page per Project, read-only --
 * displays each current Partner's (and, one level down, each current
 * Sub-partner's) Can Take, computed live from Share % × the Project's
 * available-to-withdraw amount (FR21, AD-2). No Take Now/write action here
 * -- that's Story 4.2's job (this story's Decisions). Reached from the
 * Projects list page's per-row "Withdraw Money" link, mirroring "Add Money"/
 * "Shares". Covers all 4 NFR8 states (loading/error/empty/loaded), the same
 * data-table-with-sub-rows shape as Partner Shares/Add Money (`ShareRow`,
 * Sub-partners indented one level with `↳`), plus the worked-example hint
 * line matching Should Pay's established copy pattern (EXPERIENCE.md).
 */
export default function WithdrawMoneyPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [state, setState] = useState<CanTakeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    getCanTake(projectId)
      .then((result) => {
        if (!cancelled) {
          setState({
            status: "loaded",
            availableToWithdraw: result.availableToWithdraw,
            partners: result.partners,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Something went wrong.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div>
      <PageHeader
        backHref="/projects"
        backLabel="Projects"
        title="Withdraw Money"
        description="Can Take is each Partner and Sub-partner's normal withdrawal entitlement -- their Share % of this Project's available-to-withdraw amount, computed automatically."
      />

      <Card>
        {state.status === "loading" ? (
          <p className="text-[13.4px] text-ink-soft">Loading Can Take…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.partners.length === 0 ? (
          <EmptyState
            icon={<BanknoteArrowDown size={22} />}
            title="No Partner Shares yet"
            description="Add Partner Shares for this Project before Can Take can be calculated."
          />
        ) : (
          <>
            <p className="mb-3 text-[13.4px] text-ink-soft">
              <Amount value={state.availableToWithdraw} size="sm" /> is available to withdraw from this
              Project.
            </p>
            <ShareList>
              {state.partners.map((partner) => (
                <div key={partner.partnerId}>
                  <ShareRow
                    name={partner.name}
                    input={
                      <span className="justify-self-end font-mono text-[13.4px] tabular-nums text-ink-soft">
                        {formatSharePercent(partner.sharePercent)}%
                      </span>
                    }
                    action={<Amount value={partner.canTake} />}
                  />
                  {partner.subPartners.length > 0 ? (
                    // A Partner with Sub-partners has delegated part of their Can
                    // Take away -- the `ShareRow` action above is the pooled
                    // *total* (`ownCanTake + Σ subCanTake`), so their actual
                    // retained ("Own") entitlement must be called out as its own
                    // distinct figure, never conflated with that total. Mirrors
                    // the Add Money page's identical "Own:" line for Should Pay.
                    <p className="ml-1 mt-1 text-[12.6px] font-semibold text-ink-soft">
                      Own: <Amount value={partner.ownCanTake} size="sm" />
                    </p>
                  ) : null}
                  <p className="ml-1 mt-1 text-[11.6px] text-ink-faint">
                    Share {formatSharePercent(partner.sharePercent)}% means if{" "}
                    <Amount value={state.availableToWithdraw} size="sm" /> is available to withdraw,{" "}
                    {partner.name}&apos;s normal Can Take is{" "}
                    <Amount value={partner.ownCanTake} size="sm" />.
                  </p>

                  {partner.subPartners.length > 0 ? (
                    <ShareList>
                      {partner.subPartners.map((sub) => (
                        <div key={sub.subPartnerId}>
                          <ShareRow
                            name={`↳ ${sub.name}`}
                            input={
                              <span className="justify-self-end font-mono text-[12.6px] tabular-nums text-ink-soft">
                                {formatSharePercent(sub.sharePercent)}%
                              </span>
                            }
                            action={<Amount value={sub.canTake} size="sm" />}
                          />
                        </div>
                      ))}
                    </ShareList>
                  ) : null}
                </div>
              ))}
            </ShareList>
            <DistributedCheck
              label="Can Take total"
              status={<Amount value={state.availableToWithdraw} size="sm" />}
            />
            <p className="mt-2 text-[11.6px] text-ink-faint">
              A Partner&apos;s Sub-partner split is private -- other Partners never see these rows.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
