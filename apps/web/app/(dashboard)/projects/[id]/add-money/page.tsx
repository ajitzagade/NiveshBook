"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { InvestmentRequirement } from "@niveshbook/types";
import type { PartnerShouldPay } from "@niveshbook/core";
import {
  Amount,
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
  Table,
  TableHead,
  TableBody,
  TableRow,
  Th,
  Td,
} from "@niveshbook/ui";
import { listInvestmentRequirements, addInvestmentRequirement } from "@/lib/investment-requirements";
import { getShouldPay } from "@/lib/should-pay";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; requirements: InvestmentRequirement[] };

type ShouldPayState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; partners: PartnerShouldPay[] };

/**
 * Postgres's `numeric(7,4)` column always round-trips at its full declared
 * scale (a stored `"33.33"` reads back as `"33.3300"` -- exact, no
 * precision lost, just padded). Trims trailing fractional zeros for display
 * only, via plain string manipulation (no `parseFloat`/`Number()`) -- mirrors
 * the Partner Shares page's own `formatSharePercent`.
 */
function formatSharePercent(raw: string): string {
  if (!raw.includes(".")) {
    return raw;
  }
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Add Money page (Story 3.1): one page per Project, listing every funding
 * requirement created so far (`Amount` + Date, via a `Table`) plus a
 * "+ New Requirement" `Dialog` (Amount + Date fields). Owner/Admin-only at
 * the API layer (`authorizeScope("investment_requirements:*")`) -- a
 * non-Owner/Admin sees the plain error state below, not partial data.
 * There is no edit affordance -- every requirement is a discrete,
 * never-versioned row (spec-3-1's Decisions), so this screen is
 * list-and-add only. Covers all 4 NFR8 states (loading/error/empty/
 * loaded), mirroring the Partner Shares page's established shape. This is
 * `packages/ui`'s `Amount` component's first real consumer.
 */
export default function AddMoneyPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [state, setState] = useState<ListState>({ status: "loading" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [requirementDate, setRequirementDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [expandedRequirementId, setExpandedRequirementId] = useState<string | null>(null);
  const [shouldPayByRequirement, setShouldPayByRequirement] = useState<Record<string, ShouldPayState>>(
    {},
  );
  // Cancelled/stale-response guard for `refreshShouldPay` below: if the
  // Should Pay panel is closed (or switched to a different requirement)
  // before its `getShouldPay` fetch resolves, the stale response must never
  // overwrite state for a panel the user is no longer looking at.
  const expandedRequirementIdRef = useRef<string | null>(null);

  async function refresh() {
    const result = await listInvestmentRequirements(projectId);
    setState({ status: "loaded", requirements: result.requirements });
  }

  useEffect(() => {
    let cancelled = false;

    listInvestmentRequirements(projectId)
      .then((result) => {
        if (!cancelled) {
          setState({ status: "loaded", requirements: result.requirements });
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

  /**
   * Fetches the Should Pay breakdown for one funding requirement. Guarded
   * against a stale/cancelled response via `expandedRequirementIdRef` --
   * if the user closes this panel (or expands a different requirement)
   * before this resolves, the response is dropped rather than overwriting
   * state for a panel that's no longer open. The 409 precondition states
   * (`shares_not_fully_allocated`/`sub_partner_shares_over_allocated`) both
   * throw with their own plain-language message (`apps/web/lib/should-pay.ts`)
   * -- rendered below as a plain message, mirroring every other error state
   * on this page.
   */
  async function refreshShouldPay(requirementId: string) {
    try {
      const result = await getShouldPay(projectId, requirementId);
      if (expandedRequirementIdRef.current !== requirementId) return;
      setShouldPayByRequirement((prev) => ({
        ...prev,
        [requirementId]: { status: "loaded", partners: result.partners },
      }));
    } catch (error) {
      if (expandedRequirementIdRef.current !== requirementId) return;
      setShouldPayByRequirement((prev) => ({
        ...prev,
        [requirementId]: {
          status: "error",
          message: error instanceof Error ? error.message : "Something went wrong.",
        },
      }));
    }
  }

  function toggleShouldPay(requirementId: string) {
    if (expandedRequirementId === requirementId) {
      setExpandedRequirementId(null);
      expandedRequirementIdRef.current = null;
      // If this panel's fetch never landed while it was open, its cached
      // state is stuck at "loading" -- `refreshShouldPay`'s staleness guard
      // (keyed on `expandedRequirementIdRef`) correctly drops that in-flight
      // response, but nothing else ever clears the leftover "loading" entry.
      // Without this, re-expanding later would read that stale "loading"
      // state below and never re-fetch, showing "Loading…" forever. A
      // "loaded"/"error" entry is left alone -- re-expanding a panel that
      // already finished loading shouldn't re-fetch.
      setShouldPayByRequirement((prev) => {
        if (prev[requirementId]?.status !== "loading") return prev;
        const next = { ...prev };
        delete next[requirementId];
        return next;
      });
      return;
    }
    setExpandedRequirementId(requirementId);
    expandedRequirementIdRef.current = requirementId;
    const existing = shouldPayByRequirement[requirementId];
    if (!existing || existing.status === "error") {
      setShouldPayByRequirement((prev) => ({ ...prev, [requirementId]: { status: "loading" } }));
      void refreshShouldPay(requirementId);
    }
  }

  function openAddDialog() {
    setAmount("");
    setRequirementDate("");
    setFormError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setFormError(null);
    setSubmitting(true);
    try {
      await addInvestmentRequirement(projectId, { amount, requirementDate });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    // The requirement is already saved at this point -- close the dialog
    // regardless of whether the follow-up refresh (a separate GET) below
    // succeeds. Story 3.3's idempotency keys don't exist yet, so treating a
    // refresh failure the same as a create failure would show a misleading
    // "save failed" error and could prompt the user to click Save again,
    // creating a genuine duplicate requirement.
    setSubmitting(false);
    closeDialog();
    try {
      await refresh();
    } catch {
      // Best-effort only -- the new row is already saved server-side; a
      // failed refresh just leaves the list showing its prior (stale)
      // state rather than any user-facing error.
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/projects" className="text-[12.6px] text-ink-soft hover:underline">
            ← Projects
          </Link>
          <h1 className="mt-1 text-[22px]">Add Money</h1>
          <p className="mt-1 text-[13.4px] text-ink-soft">
            Create a funding requirement for this Project -- an amount and a date. Every Partner&apos;s
            Should Pay is calculated from this once their Share % is set.
          </p>
        </div>
        <Button onClick={openAddDialog}>+ New Requirement</Button>
      </div>

      <Card>
        {state.status === "loading" ? (
          <p className="text-[13.4px] text-ink-soft">Loading funding requirements…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.requirements.length === 0 ? (
          <div>
            <p className="mb-3 text-[13.4px] text-ink-soft">
              No funding requirements yet. Create the first one to get started.
            </p>
            <Button variant="ghost" onClick={openAddDialog}>
              + New Requirement
            </Button>
          </div>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <Th className="!text-left">Date</Th>
                <Th>Amount</Th>
                <Th className="!text-right">Should Pay</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {state.requirements.map((requirement) => {
                const expanded = expandedRequirementId === requirement.id;
                const shouldPayState = shouldPayByRequirement[requirement.id];

                return (
                  <Fragment key={requirement.id}>
                    <TableRow>
                      <Td className="!text-left text-ink-soft">{requirement.requirementDate}</Td>
                      <Td>
                        <Amount value={requirement.amount} />
                      </Td>
                      <Td className="!text-right">
                        <Button
                          variant="ghost"
                          aria-expanded={expanded}
                          onClick={() => toggleShouldPay(requirement.id)}
                        >
                          {expanded ? "Hide" : "Should Pay"}
                        </Button>
                      </Td>
                    </TableRow>

                    {expanded ? (
                      <TableRow>
                        <Td colSpan={3} className="!text-left">
                          <div className="my-2 flex flex-col gap-2.5 border-l border-border pl-3">
                            {!shouldPayState || shouldPayState.status === "loading" ? (
                              <p className="text-[12.6px] text-ink-soft">Loading Should Pay…</p>
                            ) : shouldPayState.status === "error" ? (
                              <p role="alert" className="text-[12.6px] text-danger">
                                {shouldPayState.message}
                              </p>
                            ) : shouldPayState.partners.length === 0 ? (
                              <p className="text-[12.6px] text-ink-soft">
                                No Partner Shares yet for this Project.
                              </p>
                            ) : (
                              <>
                                <ShareList>
                                  {shouldPayState.partners.map((partner) => (
                                    <div key={partner.partnerId}>
                                      <ShareRow
                                        name={partner.name}
                                        input={
                                          <span className="justify-self-end font-mono text-[12.6px] tabular-nums text-ink-soft">
                                            {formatSharePercent(partner.sharePercent)}%
                                          </span>
                                        }
                                        action={<Amount value={partner.shouldPay} size="sm" />}
                                      />
                                      {partner.subPartners.length > 0 ? (
                                        // A Partner with Sub-partners has delegated part of their
                                        // Should Pay away -- the `ShareRow` action above is the
                                        // pooled *total* (`ownShouldPay + Σ subShouldPay`), so their
                                        // actual retained ("Own") obligation must be called out as
                                        // its own distinct figure (AC2), never conflated with that
                                        // total. Mirrors the Shares page's `retainedMessage` precedent.
                                        <p className="ml-1 mt-1 text-[12.6px] font-semibold text-ink-soft">
                                          Own: <Amount value={partner.ownShouldPay} size="sm" />
                                        </p>
                                      ) : null}
                                      <p className="ml-1 mt-1 text-[11.6px] text-ink-faint">
                                        Share {formatSharePercent(partner.sharePercent)}% means if the
                                        project needs <Amount value={requirement.amount} size="sm" />,{" "}
                                        {partner.name}&apos;s normal share is{" "}
                                        <Amount value={partner.ownShouldPay} size="sm" />.
                                      </p>

                                      {partner.subPartners.length > 0 ? (
                                        <ShareList>
                                          {partner.subPartners.map((sub) => (
                                            <ShareRow
                                              key={sub.subPartnerId}
                                              name={`↳ ${sub.name}`}
                                              input={
                                                <span className="justify-self-end font-mono text-[12.6px] tabular-nums text-ink-soft">
                                                  {formatSharePercent(sub.sharePercent)}%
                                                </span>
                                              }
                                              action={<Amount value={sub.shouldPay} size="sm" />}
                                            />
                                          ))}
                                        </ShareList>
                                      ) : null}
                                    </div>
                                  ))}
                                </ShareList>
                                <DistributedCheck
                                  label="Should Pay total"
                                  status={<Amount value={requirement.amount} size="sm" />}
                                />
                              </>
                            )}
                          </div>
                        </Td>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>New Funding Requirement</DialogTitle>
          <DialogDescription>
            Owner/Admin only. Each funding round is its own new record -- a past requirement is never
            edited.
          </DialogDescription>
          <form onSubmit={handleSubmit} className="mt-4">
            <Field>
              <Label htmlFor="requirement-amount">Amount</Label>
              <Input
                id="requirement-amount"
                name="amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
                autoFocus
              />
              <Helper>e.g. 1000000 for ₹10,00,000 -- up to 2 decimal places are supported.</Helper>
            </Field>
            <Field>
              <Label htmlFor="requirement-date">Date</Label>
              <Input
                id="requirement-date"
                name="requirementDate"
                type="date"
                value={requirementDate}
                onChange={(event) => setRequirementDate(event.target.value)}
                required
              />
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
