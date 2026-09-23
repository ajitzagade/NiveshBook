"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { PartnerShare, SubPartnerShare } from "@niveshbook/types";
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DistributedCheck,
  Field,
  Helper,
  Input,
  Label,
  ShareList,
  ShareRow,
} from "@niveshbook/ui";
import { listPartnerShares, addPartnerShare, updatePartnerShare } from "@/lib/partner-shares";
import {
  listSubPartnerShares,
  addSubPartnerShare,
  updateSubPartnerShare,
} from "@/lib/subpartner-shares";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; shares: PartnerShare[]; total: string };

type SubListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; shares: SubPartnerShare[]; total: string };

type DialogState =
  | { open: false }
  | { open: true; mode: "add" }
  | { open: true; mode: "edit"; partnerId: string }
  | { open: true; mode: "add-sub"; partnerId: string }
  | { open: true; mode: "edit-sub"; partnerId: string; subPartnerId: string };

/**
 * Rounds to 4 decimal places and trims trailing zeros/decimal point, so a
 * display-only difference (e.g. `100 - 83.33`) never shows binary-float
 * noise like `16.670000000000002`. Display-only arithmetic like this is
 * explicitly allowed in `apps/web` (spec-2-2's Decisions) -- it never
 * touches a stored value, which always goes through `packages/core`'s
 * `decimal-math.ts` instead.
 */
function formatDifference(value: number): string {
  return (Math.round(value * 10000) / 10000).toString();
}

/**
 * Postgres's `numeric(7,4)` column always round-trips at its full declared
 * scale (a stored `"33.33"` reads back as `"33.3300"` -- exact, no
 * precision lost, just padded). Trims trailing fractional zeros for
 * display only, via plain string manipulation (no `parseFloat`/`Number()`)
 * -- the stored/edited value itself is untouched.
 */
function formatSharePercent(raw: string): string {
  if (!raw.includes(".")) {
    return raw;
  }
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * The live running-total message (this story's AC1-AC3): exact-100%,
 * under-100% ("remaining"), and over-100% ("reduce by") phrasing, all
 * informational-only -- never blocks an individual Partner's add/edit from
 * saving (spec-2-2's Decisions).
 */
function totalMessage(total: string): string {
  const totalNum = Number(total);
  if (totalNum === 100) {
    return "Total Share: 100% ✓";
  }
  if (totalNum < 100) {
    return `Total is ${total}%. ${formatDifference(100 - totalNum)}% is still remaining.`;
  }
  return `Total is ${total}%. Please reduce by ${formatDifference(totalNum - 100)}%.`;
}

/**
 * Story 2.3's per-Partner Sub-partner allocation message -- mirrors
 * `totalMessage`'s exact/under/over phrasing but scoped to the parent
 * Partner's own Share % (e.g. "Allocated: 50% ✓" for a Partner holding
 * 50%), never against the Project's 100% total. Informational only --
 * never blocks an add/edit from saving (spec-2-3's Decisions).
 */
function subAllocationMessage(partnerSharePercent: string, subTotal: string): string {
  const partnerNum = Number(partnerSharePercent);
  const subTotalNum = Number(subTotal);
  if (subTotalNum === partnerNum) {
    return `Allocated: ${subTotal}% ✓`;
  }
  if (subTotalNum < partnerNum) {
    return `Allocated: ${subTotal}% (${formatDifference(partnerNum - subTotalNum)}% remaining)`;
  }
  return `Allocated: ${subTotal}% (over by ${formatDifference(subTotalNum - partnerNum)}%)`;
}

/**
 * A Partner's own retained portion -- computed live, never stored (this
 * story's Decisions): the Partner's current `sharePercent` minus the sum
 * of their current Sub-partner allocations. Can legitimately be negative
 * (over-allocated) -- nothing here clamps it, mirroring `subAllocationMessage`'s
 * own no-block stance.
 */
function retainedMessage(partnerName: string, partnerSharePercent: string, subTotal: string): string {
  const retained = formatDifference(Number(partnerSharePercent) - Number(subTotal));
  return `${partnerName} retained: ${retained}%`;
}

/**
 * Partner Shares page (Story 2.2, extended by Story 2.3): one page per
 * Project, listing current Partner Shares via `ShareList`/`ShareRow` plus a
 * `DistributedCheck` showing the live total, with a `Dialog` (name + Share %
 * fields) for both add and edit -- reusing components built speculatively
 * for this screen (`packages/ui`'s `ShareRow`/`ShareList`/`DistributedCheck`).
 * Covers all 4 NFR8 states (loading/error/empty/loaded).
 *
 * Story 2.3 adds an expand affordance per Partner row: its current
 * Sub-partner Shares render inline, one indent level under the Partner with
 * a `↳` prefix and smaller muted text (never a second indent level), plus
 * a per-Partner `DistributedCheck` ("Allocated: X% (Y% remaining)") scoped
 * to that Partner's own Share % -- not the Project's 100% total -- and a
 * computed "retained" line (never stored, see `retainedMessage`). Reuses
 * the same `ShareRow`/`ShareList`/`DistributedCheck`/`Dialog` components a
 * second time, scoped to one Partner at a time -- no new components.
 */
export default function PartnerSharesPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [state, setState] = useState<ListState>({ status: "loading" });
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [name, setName] = useState("");
  const [sharePercent, setSharePercent] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [expandedPartnerId, setExpandedPartnerId] = useState<string | null>(null);
  const [subSharesByPartner, setSubSharesByPartner] = useState<Record<string, SubListState>>({});

  async function refresh() {
    const result = await listPartnerShares(projectId);
    setState({ status: "loaded", shares: result.shares, total: result.total });
  }

  useEffect(() => {
    let cancelled = false;

    listPartnerShares(projectId)
      .then((result) => {
        if (!cancelled) {
          setState({ status: "loaded", shares: result.shares, total: result.total });
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

  async function refreshSubShares(partnerId: string) {
    try {
      const result = await listSubPartnerShares(projectId, partnerId);
      setSubSharesByPartner((prev) => ({
        ...prev,
        [partnerId]: { status: "loaded", shares: result.shares, total: result.total },
      }));
    } catch (error) {
      setSubSharesByPartner((prev) => ({
        ...prev,
        [partnerId]: {
          status: "error",
          message: error instanceof Error ? error.message : "Something went wrong.",
        },
      }));
    }
  }

  function toggleExpanded(partnerId: string) {
    if (expandedPartnerId === partnerId) {
      setExpandedPartnerId(null);
      return;
    }
    setExpandedPartnerId(partnerId);
    const existing = subSharesByPartner[partnerId];
    if (!existing || existing.status === "error") {
      setSubSharesByPartner((prev) => ({ ...prev, [partnerId]: { status: "loading" } }));
      void refreshSubShares(partnerId);
    }
  }

  function openAddDialog() {
    setName("");
    setSharePercent("");
    setFormError(null);
    setDialog({ open: true, mode: "add" });
  }

  function openEditDialog(share: PartnerShare) {
    setName(share.name);
    setSharePercent(formatSharePercent(share.sharePercent));
    setFormError(null);
    setDialog({ open: true, mode: "edit", partnerId: share.partnerId });
  }

  function openAddSubDialog(partnerId: string) {
    setName("");
    setSharePercent("");
    setFormError(null);
    setDialog({ open: true, mode: "add-sub", partnerId });
  }

  function openEditSubDialog(partnerId: string, subShare: SubPartnerShare) {
    setName(subShare.name);
    setSharePercent(formatSharePercent(subShare.sharePercent));
    setFormError(null);
    setDialog({ open: true, mode: "edit-sub", partnerId, subPartnerId: subShare.subPartnerId });
  }

  function closeDialog() {
    setDialog({ open: false });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog.open) return;

    setFormError(null);
    setSubmitting(true);
    try {
      if (dialog.mode === "add") {
        await addPartnerShare(projectId, { name, sharePercent });
        await refresh();
      } else if (dialog.mode === "edit") {
        await updatePartnerShare(projectId, dialog.partnerId, { name, sharePercent });
        await refresh();
      } else if (dialog.mode === "add-sub") {
        await addSubPartnerShare(projectId, dialog.partnerId, { name, sharePercent });
        await refreshSubShares(dialog.partnerId);
      } else {
        await updateSubPartnerShare(projectId, dialog.partnerId, dialog.subPartnerId, {
          name,
          sharePercent,
        });
        await refreshSubShares(dialog.partnerId);
      }
      // Refresh before closing the dialog -- if this throws, the `catch`
      // below sets `formError`, which must still render inside the (still
      // open) dialog rather than being silently dropped.
      closeDialog();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const dialogTitle =
    dialog.open && dialog.mode === "edit"
      ? "Edit Partner"
      : dialog.open && dialog.mode === "add-sub"
        ? "Add Sub-partner"
        : dialog.open && dialog.mode === "edit-sub"
          ? "Edit Sub-partner"
          : "Add Partner";

  const dialogDescription =
    dialog.open && (dialog.mode === "add-sub" || dialog.mode === "edit-sub")
      ? "Share % is this Sub-partner's ownership of the full Project -- e.g. 12.5 means they own 12.5% of this Project, never 12.5% of their parent Partner's share."
      : "Share % is this Partner's ownership of the full Project -- e.g. 33.33 means they own 33.33% of this Project, never 33.33% of another Partner's share.";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/projects" className="text-[12.6px] text-ink-soft hover:underline">
            ← Projects
          </Link>
          <h1 className="mt-1 text-[22px]">Partner Shares</h1>
          <p className="mt-1 text-[13.4px] text-ink-soft">
            Add Partners with a Share % of this Project. The total is checked against 100%, but you
            can save at any point -- Partners are often added over time.
          </p>
        </div>
        <Button onClick={openAddDialog}>+ Add Partner</Button>
      </div>

      <Card>
        {state.status === "loading" ? (
          <p className="text-[13.4px] text-ink-soft">Loading Partner Shares…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.shares.length === 0 ? (
          <div>
            <p className="mb-3 text-[13.4px] text-ink-soft">
              No Partner Shares yet. Add the first Partner to get started.
            </p>
            <Button variant="ghost" onClick={openAddDialog}>
              + Add Partner
            </Button>
          </div>
        ) : (
          <ShareList>
            {state.shares.map((share) => {
              const expanded = expandedPartnerId === share.partnerId;
              const subState = subSharesByPartner[share.partnerId];

              return (
                <div key={share.partnerId}>
                  <ShareRow
                    name={share.name}
                    input={
                      <span className="justify-self-end font-mono text-[13.4px] tabular-nums">
                        {formatSharePercent(share.sharePercent)}%
                      </span>
                    }
                    action={
                      <div className="flex gap-1.5">
                        <Button variant="ghost" onClick={() => openEditDialog(share)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          aria-expanded={expanded}
                          onClick={() => toggleExpanded(share.partnerId)}
                        >
                          {expanded ? "Hide" : "Sub-partners"}
                        </Button>
                      </div>
                    }
                  />

                  {expanded ? (
                    <div className="ml-5 mt-2 flex flex-col gap-2.5 border-l border-border pl-3">
                      {!subState || subState.status === "loading" ? (
                        <p className="text-[12.6px] text-ink-soft">Loading Sub-partners…</p>
                      ) : subState.status === "error" ? (
                        <p role="alert" className="text-[12.6px] text-danger">
                          {subState.message}
                        </p>
                      ) : (
                        <>
                          {subState.shares.length === 0 ? (
                            <p className="text-[12.6px] text-ink-soft">
                              No Sub-partners yet for {share.name}.
                            </p>
                          ) : (
                            <ShareList>
                              {subState.shares.map((subShare) => (
                                <ShareRow
                                  key={subShare.subPartnerId}
                                  name={`↳ ${subShare.name}`}
                                  input={
                                    <span className="justify-self-end font-mono text-[12.6px] tabular-nums text-ink-soft">
                                      {formatSharePercent(subShare.sharePercent)}%
                                    </span>
                                  }
                                  action={
                                    <Button
                                      variant="ghost"
                                      onClick={() => openEditSubDialog(share.partnerId, subShare)}
                                    >
                                      Edit
                                    </Button>
                                  }
                                />
                              ))}
                            </ShareList>
                          )}

                          <DistributedCheck
                            label="Sub-partner Shares"
                            status={subAllocationMessage(share.sharePercent, subState.total)}
                          />
                          <p className="text-[12.6px] font-semibold text-ink-soft">
                            {retainedMessage(share.name, share.sharePercent, subState.total)}
                          </p>

                          <div>
                            <Button variant="ghost" onClick={() => openAddSubDialog(share.partnerId)}>
                              + Add Sub-partner
                            </Button>
                          </div>

                          <p className="text-[11.6px] text-ink-faint">
                            {share.name}&apos;s sub-partner split is private -- other Partners never
                            see these rows.
                          </p>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </ShareList>
        )}
        {state.status === "loaded" ? (
          <DistributedCheck label="Partner Shares" status={totalMessage(state.total)} />
        ) : null}
      </Card>

      <Dialog
        open={dialog.open}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
          <form onSubmit={handleSubmit} className="mt-4">
            <Field>
              <Label htmlFor="partner-name">Name</Label>
              <Input
                id="partner-name"
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field>
              <Label htmlFor="partner-share-percent">Share %</Label>
              <Input
                id="partner-share-percent"
                name="sharePercent"
                inputMode="decimal"
                value={sharePercent}
                onChange={(event) => setSharePercent(event.target.value)}
                required
              />
              <Helper>e.g. 33.33 for a one-third Share -- up to 4 decimal places are supported.</Helper>
            </Field>

            {formError ? (
              <p role="alert" className="mb-4 text-[13.4px] text-danger">
                {formError}
              </p>
            ) : null}

            <div className="flex gap-2.5">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" onClick={closeDialog} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
