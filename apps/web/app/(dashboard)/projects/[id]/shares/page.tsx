"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Percent, UserPlus, Pencil, Users, ChevronUp, Save, X } from "lucide-react";
import type { PartnerShare, SubPartnerShare } from "@niveshbook/types";
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DistributedCheck,
  EmptyState,
  Field,
  Helper,
  Input,
  Label,
  PageHeader,
  PersonCard,
  ShareList,
  toast,
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
 * Partner Shares page (Story 2.2, extended by Story 2.3; reshaped by the
 * founder-approved hybrid, spec-partner-hierarchy-cards 2026-09-26): one
 * page per Project, listing current Partner Shares as teal-tinted
 * `PersonCard`s plus a `DistributedCheck` showing the live total, with a
 * `Dialog` (name + Share % fields) for both add and edit. Covers all 4
 * NFR8 states (loading/error/empty/loaded).
 *
 * Story 2.3 adds an expand affordance per Partner card: its current
 * Sub-partner Shares render as violet-tinted cards nested INSIDE the
 * Partner's own card behind a colored rail (containment + role tint carry
 * the hierarchy -- the earlier `↳`-prefix/indent presentation is
 * superseded), plus a per-Partner `DistributedCheck` ("Allocated: X% (Y%
 * remaining)") scoped to that Partner's own Share % -- not the Project's
 * 100% total -- and a computed "retained" line (never stored, see
 * `retainedMessage`).
 */
export default function PartnerSharesPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [state, setState] = useState<ListState>({ status: "loading" });
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [name, setName] = useState("");
  const [sharePercent, setSharePercent] = useState("");
  const [linkedUserEmail, setLinkedUserEmail] = useState("");
  // Story 2.6: only meaningful for the Add/Edit Partner dialog (never the
  // Sub-partner dialog) -- Owner/Admin-only opt-in grant letting this
  // Partner's own current Sub-partners see the Partner's total Share %.
  // Full-overwrite-per-save, same convention as `linkedUserEmail`.
  const [subPartnerVisibilityGrant, setSubPartnerVisibilityGrant] = useState(false);
  // Story 2.4: the `userId` of the share currently open for edit, if it has
  // one -- `null` for "add" dialogs or an edit of an unlinked share. Used
  // (with `userEmailById` below) to detect "this share IS linked, but we
  // don't know the email yet" so the field is never silently blank for an
  // already-linked share -- since every save is a full overwrite, a blank
  // `linkedUserEmail` means "unlink", so saving a stale blank would
  // silently destroy a real link.
  const [editingShareUserId, setEditingShareUserId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [expandedPartnerId, setExpandedPartnerId] = useState<string | null>(null);
  const [subSharesByPartner, setSubSharesByPartner] = useState<Record<string, SubListState>>({});

  // Story 2.4: a `userId -> email` lookup, built once from the existing
  // Owner/Admin-scoped user directory, so the Add/Edit dialogs can
  // pre-populate "Linked user (email)" for an already-linked Partner/
  // Sub-partner. Best-effort only -- if this fetch fails, the field simply
  // starts blank; it never blocks the Partner Shares screen itself from
  // loading.
  const [userEmailById, setUserEmailById] = useState<Record<string, string>>({});

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

  // Eagerly prefetches every Partner's Sub-partner count as soon as the
  // Partner Shares list itself loads (or changes, e.g. after adding a new
  // Partner) -- so the "Sub-partners" button can show a count (e.g.
  // "Sub-partners (2)") without the Owner/Admin needing to click into each
  // Partner one at a time to find out whether any exist. `toggleExpanded`'s
  // own on-click fetch (`refreshSubShares`) still runs unchanged as a
  // fallback/retry path (e.g. if this prefetch failed for a given Partner);
  // it's a no-op here whenever this prefetch already populated the entry.
  // `subSharesByPartner` is intentionally excluded from the dependency array
  // (read only to skip already-known Partners) -- including it would re-run
  // this effect every time it's the one updating that same state.
  useEffect(() => {
    if (state.status !== "loaded") return;
    let cancelled = false;

    for (const share of state.shares) {
      if (subSharesByPartner[share.partnerId]) continue;
      listSubPartnerShares(projectId, share.partnerId)
        .then((result) => {
          if (cancelled) return;
          setSubSharesByPartner((prev) =>
            prev[share.partnerId]
              ? prev
              : { ...prev, [share.partnerId]: { status: "loaded", shares: result.shares, total: result.total } },
          );
        })
        .catch(() => {
          // Best-effort prefetch only -- the count badge simply stays hidden
          // for this Partner; clicking "Sub-partners" still retries via
          // `toggleExpanded`/`refreshSubShares` and surfaces the real error.
        });
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, projectId]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/users")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("failed"))))
      .then((users: unknown) => {
        if (cancelled || !Array.isArray(users)) return;
        const lookup: Record<string, string> = {};
        for (const user of users) {
          if (
            user &&
            typeof user === "object" &&
            typeof (user as { id?: unknown }).id === "string" &&
            typeof (user as { email?: unknown }).email === "string"
          ) {
            lookup[(user as { id: string }).id] = (user as { email: string }).email;
          }
        }
        setUserEmailById(lookup);
      })
      .catch(() => {
        // Best-effort pre-population only -- an Owner/Admin can still type
        // the email manually if this fetch fails.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Story 2.4: if the `/api/users` lookup above resolves (or updates) while
  // an Edit dialog for an already-linked share is open and its email wasn't
  // known yet, backfill the field once it becomes available -- otherwise
  // the pending-guard below would leave Save disabled indefinitely even
  // after the email is known.
  useEffect(() => {
    if (editingShareUserId === null) return;
    const resolvedEmail = userEmailById[editingShareUserId];
    if (resolvedEmail !== undefined) {
      setLinkedUserEmail(resolvedEmail);
    }
  }, [userEmailById, editingShareUserId]);

  // True while editing a share that IS linked to a user but whose email
  // hasn't been resolved yet (the `/api/users` fetch above hasn't completed
  // or failed) -- the field would otherwise render blank, and since every
  // save is a full overwrite (empty `linkedUserEmail` means "unlink"),
  // saving in this state would silently destroy a real link. Recomputed
  // every render, so it clears itself as soon as `userEmailById` resolves.
  const linkedUserEmailPending =
    editingShareUserId !== null && userEmailById[editingShareUserId] === undefined;

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
    setLinkedUserEmail("");
    setSubPartnerVisibilityGrant(false);
    setEditingShareUserId(null);
    setFormError(null);
    setDialog({ open: true, mode: "add" });
  }

  function openEditDialog(share: PartnerShare) {
    setName(share.name);
    setSharePercent(formatSharePercent(share.sharePercent));
    setLinkedUserEmail(share.userId ? (userEmailById[share.userId] ?? "") : "");
    setSubPartnerVisibilityGrant(share.subPartnerVisibilityGrant);
    setEditingShareUserId(share.userId);
    setFormError(null);
    setDialog({ open: true, mode: "edit", partnerId: share.partnerId });
  }

  function openAddSubDialog(partnerId: string) {
    setName("");
    setSharePercent("");
    setLinkedUserEmail("");
    setEditingShareUserId(null);
    setFormError(null);
    setDialog({ open: true, mode: "add-sub", partnerId });
  }

  function openEditSubDialog(partnerId: string, subShare: SubPartnerShare) {
    setName(subShare.name);
    setSharePercent(formatSharePercent(subShare.sharePercent));
    setLinkedUserEmail(subShare.userId ? (userEmailById[subShare.userId] ?? "") : "");
    setEditingShareUserId(subShare.userId);
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
        await addPartnerShare(projectId, {
          name,
          sharePercent,
          linkedUserEmail,
          subPartnerVisibilityGrant,
        });
        await refresh();
        toast.success(`${name} added with a ${formatSharePercent(sharePercent)}% share`);
      } else if (dialog.mode === "edit") {
        await updatePartnerShare(projectId, dialog.partnerId, {
          name,
          sharePercent,
          linkedUserEmail,
          subPartnerVisibilityGrant,
        });
        await refresh();
        toast.success(`${name}'s share updated to ${formatSharePercent(sharePercent)}%`);
      } else if (dialog.mode === "add-sub") {
        await addSubPartnerShare(projectId, dialog.partnerId, { name, sharePercent, linkedUserEmail });
        await refreshSubShares(dialog.partnerId);
        toast.success(`${name} added as a Sub-partner with a ${formatSharePercent(sharePercent)}% share`);
      } else {
        await updateSubPartnerShare(projectId, dialog.partnerId, dialog.subPartnerId, {
          name,
          sharePercent,
          linkedUserEmail,
        });
        await refreshSubShares(dialog.partnerId);
        toast.success(`${name}'s share updated to ${formatSharePercent(sharePercent)}%`);
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
      <PageHeader
        backHref="/projects"
        backLabel="Projects"
        title="Partner Shares"
        description="Add Partners with a Share % of this Project. The total is checked against 100%, but you can save at any point -- Partners are often added over time."
        action={
          <Button onClick={openAddDialog} icon={<UserPlus size={14} />}>
            Add Partner
          </Button>
        }
      />

      <Card>
        {state.status === "loading" ? (
          <p className="text-[13.4px] text-ink-soft">Loading Partner Shares…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.shares.length === 0 ? (
          <EmptyState
            icon={<Percent size={22} />}
            title="No Partner Shares yet"
            description="Add the first Partner and their Share % to start tracking this Project's ownership."
            action={
              <Button variant="ghost" tone="info" onClick={openAddDialog} icon={<UserPlus size={14} />}>
                Add Partner
              </Button>
            }
          />
        ) : (
          <ShareList>
            {state.shares.map((share) => {
              const expanded = expandedPartnerId === share.partnerId;
              const subState = subSharesByPartner[share.partnerId];

              // Founder-approved hybrid (spec-partner-hierarchy-cards): each
              // Partner is a teal-tinted `PersonCard`; its expanded
              // Sub-partners render as violet cards nested INSIDE it, behind
              // the card's colored rail -- containment + tint carry the
              // hierarchy, so no `↳` glyph or extra indent is needed here.
              return (
                <PersonCard
                  key={share.partnerId}
                  role="partner"
                  name={share.name}
                  value={
                    <span className="font-mono text-[13.4px] tabular-nums">
                      {formatSharePercent(share.sharePercent)}%
                    </span>
                  }
                  action={
                    <div className="flex flex-wrap gap-1.5">
                      <Button variant="ghost" tone="accent" onClick={() => openEditDialog(share)} icon={<Pencil size={14} />}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        aria-expanded={expanded}
                        onClick={() => toggleExpanded(share.partnerId)}
                        icon={expanded ? <ChevronUp size={14} /> : <Users size={14} />}
                      >
                        {expanded
                          ? "Hide"
                          : subState?.status === "loaded" && subState.shares.length > 0
                            ? `Sub-partners (${subState.shares.length})`
                            : "Sub-partners"}
                      </Button>
                    </div>
                  }
                  nested={
                    expanded ? (
                      !subState || subState.status === "loading" ? (
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
                            subState.shares.map((subShare) => (
                              <PersonCard
                                key={subShare.subPartnerId}
                                role="sub_partner"
                                name={subShare.name}
                                value={
                                  <span className="font-mono text-[12.6px] tabular-nums text-ink-soft">
                                    {formatSharePercent(subShare.sharePercent)}%
                                  </span>
                                }
                                action={
                                  <Button
                                    variant="ghost"
                                    tone="accent"
                                    onClick={() => openEditSubDialog(share.partnerId, subShare)}
                                    icon={<Pencil size={14} />}
                                  >
                                    Edit
                                  </Button>
                                }
                              />
                            ))
                          )}

                          <DistributedCheck
                            label="Sub-partner Shares"
                            status={subAllocationMessage(share.sharePercent, subState.total)}
                          />
                          <p className="text-[12.6px] font-semibold text-ink-soft">
                            {retainedMessage(share.name, share.sharePercent, subState.total)}
                          </p>

                          <div>
                            <Button
                              variant="ghost"
                              tone="info"
                              onClick={() => openAddSubDialog(share.partnerId)}
                              icon={<UserPlus size={14} />}
                            >
                              Add Sub-partner
                            </Button>
                          </div>

                          <p className="text-[11.6px] text-ink-faint">
                            {share.name}&apos;s sub-partner split is private -- other Partners never
                            see these rows.
                          </p>
                        </>
                      )
                    ) : null
                  }
                />
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
            <Field>
              <Label htmlFor="linked-user-email">Linked user (email)</Label>
              <Input
                id="linked-user-email"
                name="linkedUserEmail"
                type="email"
                value={linkedUserEmail}
                onChange={(event) => setLinkedUserEmail(event.target.value)}
                disabled={linkedUserEmailPending}
                placeholder={linkedUserEmailPending ? "Loading current link…" : undefined}
              />
              <Helper>
                {linkedUserEmailPending
                  ? "Loading the currently linked user's email -- please wait before saving."
                  : dialog.open && (dialog.mode === "add-sub" || dialog.mode === "edit-sub")
                    ? "Optional -- links this Sub-partner to a login with the Sub-partner role, so they can see only their own data. Leave blank for no link."
                    : "Optional -- links this Partner to a login with the Partner role, so they can see only their own data (never a co-partner's). Leave blank for no link."}
              </Helper>
            </Field>
            {dialog.open && (dialog.mode === "add" || dialog.mode === "edit") ? (
              <Field>
                <label className="flex items-center gap-2 text-[13.4px] text-ink">
                  <Checkbox
                    name="subPartnerVisibilityGrant"
                    checked={subPartnerVisibilityGrant}
                    onChange={(event) => setSubPartnerVisibilityGrant(event.target.checked)}
                  />
                  Let this Partner&apos;s Sub-partners see their total Share %
                </label>
                <Helper>
                  Optional -- when on, this Partner&apos;s own Sub-partners can see the
                  Partner&apos;s total Share % (nothing else). Off by default. Takes effect
                  immediately, both ways.
                </Helper>
              </Field>
            ) : null}

            {formError ? (
              <p role="alert" className="mb-4 text-[13.4px] text-danger">
                {formError}
              </p>
            ) : null}

            <div className="flex gap-2.5">
              <Button
                type="submit"
                disabled={submitting || linkedUserEmailPending}
                icon={<Save size={14} />}
              >
                {submitting ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={closeDialog}
                disabled={submitting}
                icon={<X size={14} />}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
