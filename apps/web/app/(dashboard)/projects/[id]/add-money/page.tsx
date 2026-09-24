"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { InvestmentRequirement, InvestmentTransaction, PaymentMode } from "@niveshbook/types";
import type { PartnerInvestmentAdjustment, PartnerShouldPayWithRecommended } from "@niveshbook/core";
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
  StatusChip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  Th,
  Td,
  type StatusChipVariant,
} from "@niveshbook/ui";
import { listInvestmentRequirements, addInvestmentRequirement } from "@/lib/investment-requirements";
import { getShouldPay } from "@/lib/should-pay";
import {
  listInvestmentTransactions,
  recordInvestmentTransaction,
} from "@/lib/investment-transactions";
import { getInvestmentAdjustments } from "@/lib/investment-adjustments";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; requirements: InvestmentRequirement[] };

type ShouldPayState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; partners: PartnerShouldPayWithRecommended[] };

type TransactionsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; transactions: InvestmentTransaction[] };

// Story 3.4: the per-person Adjustment status chip shown alongside each
// Should Pay row -- fetched alongside Should Pay/transactions when a panel
// expands. Errors here are swallowed rather than shown (see
// `refreshAdjustments`'s own doc comment) -- unlike Should Pay/transactions,
// this is a secondary enrichment, not the panel's primary content.
type AdjustmentsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; partners: PartnerInvestmentAdjustment[] };

interface RecordPaymentTarget {
  requirementId: string;
  partyType: "partner" | "sub_partner";
  shareId: string;
  personName: string;
}

/**
 * Every valid `PaymentMode`, in display order -- the `Record<PaymentMode, string>`
 * forces this list to stay exhaustive against `packages/types`'s `PaymentMode`
 * union at compile time, mirroring `apps/web/lib/users.ts`'s `ROLE_LABEL`
 * precedent. Kept local to this page (rather than imported across the `app/api`
 * route-group boundary) -- this page's only consumer.
 */
const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  cheque: "Cheque",
  neft: "NEFT",
  rtgs: "RTGS",
  imps: "IMPS",
  upi: "UPI",
  bank_transfer: "Bank Transfer",
  other: "Other",
};
const PAYMENT_MODE_OPTIONS = (Object.entries(PAYMENT_MODE_LABELS) as [PaymentMode, string][]).map(
  ([value, label]) => ({ value, label }),
);

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

  // Story 3.3: the recorded-payments list shown alongside each Should Pay
  // panel -- fetched alongside Should Pay when a panel expands, guarded by
  // the same `expandedRequirementIdRef` staleness check.
  const [transactionsByRequirement, setTransactionsByRequirement] = useState<
    Record<string, TransactionsState>
  >({});

  // Story 3.4: the Adjustment status chip data shown per Partner/Sub-partner
  // row -- fetched alongside Should Pay/transactions when a panel expands.
  const [adjustmentsByRequirement, setAdjustmentsByRequirement] = useState<
    Record<string, AdjustmentsState>
  >({});

  const [recordPaymentTarget, setRecordPaymentTarget] = useState<RecordPaymentTarget | null>(null);
  const [recordAmount, setRecordAmount] = useState("");
  const [recordDate, setRecordDate] = useState("");
  const [recordPaymentMode, setRecordPaymentMode] = useState<PaymentMode>("cash");
  const [recordReferenceNumber, setRecordReferenceNumber] = useState("");
  const [recordNotes, setRecordNotes] = useState("");
  const [recordFormError, setRecordFormError] = useState<string | null>(null);
  const [recordSubmitting, setRecordSubmitting] = useState(false);
  // Minted once per *logical* submission attempt (when the dialog opens),
  // never inside the submit handler -- a retry after a failure (same dialog
  // still open) reuses this same key, so a real double-submit is actually
  // deduped server-side (AD-5/AC4). Only closing and reopening the dialog
  // (or a successful save, which closes it) mints a new one.
  const [recordIdempotencyKey, setRecordIdempotencyKey] = useState("");

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

  /**
   * Fetches the recorded payments for one funding requirement (Story 3.3) --
   * mirrors `refreshShouldPay`'s staleness-guard pattern exactly, sharing the
   * same `expandedRequirementIdRef`.
   */
  async function refreshTransactions(requirementId: string) {
    try {
      const result = await listInvestmentTransactions(projectId, requirementId);
      if (expandedRequirementIdRef.current !== requirementId) return;
      setTransactionsByRequirement((prev) => ({
        ...prev,
        [requirementId]: { status: "loaded", transactions: result.transactions },
      }));
    } catch (error) {
      if (expandedRequirementIdRef.current !== requirementId) return;
      setTransactionsByRequirement((prev) => ({
        ...prev,
        [requirementId]: {
          status: "error",
          message: error instanceof Error ? error.message : "Something went wrong.",
        },
      }));
    }
  }

  /**
   * Fetches the Investment Adjustment status per Partner/Sub-partner for one
   * funding requirement (Story 3.4) -- mirrors `refreshShouldPay`'s
   * staleness-guard pattern exactly, sharing the same
   * `expandedRequirementIdRef`. Failures are swallowed to `"error"` state
   * (never surfaced as a blocking page error) -- an adjustment chip is a
   * secondary enrichment of the Should Pay panel, not its primary content,
   * so a failed fetch here simply means no chips show, while Should Pay
   * itself still renders normally.
   */
  async function refreshAdjustments(requirementId: string) {
    try {
      const result = await getInvestmentAdjustments(projectId, requirementId);
      if (expandedRequirementIdRef.current !== requirementId) return;
      setAdjustmentsByRequirement((prev) => ({
        ...prev,
        [requirementId]: { status: "loaded", partners: result.partners },
      }));
    } catch (error) {
      if (expandedRequirementIdRef.current !== requirementId) return;
      setAdjustmentsByRequirement((prev) => ({
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
      setTransactionsByRequirement((prev) => {
        if (prev[requirementId]?.status !== "loading") return prev;
        const next = { ...prev };
        delete next[requirementId];
        return next;
      });
      setAdjustmentsByRequirement((prev) => {
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
    const existingTransactions = transactionsByRequirement[requirementId];
    if (!existingTransactions || existingTransactions.status === "error") {
      setTransactionsByRequirement((prev) => ({ ...prev, [requirementId]: { status: "loading" } }));
      void refreshTransactions(requirementId);
    }
    const existingAdjustments = adjustmentsByRequirement[requirementId];
    if (!existingAdjustments || existingAdjustments.status === "error") {
      setAdjustmentsByRequirement((prev) => ({ ...prev, [requirementId]: { status: "loading" } }));
      void refreshAdjustments(requirementId);
    }
  }

  /** Every transaction recorded against `shareId`/`partyType` for one requirement, or `[]` if the list hasn't loaded (yet). */
  function recordedPaymentsFor(
    requirementId: string,
    partyType: "partner" | "sub_partner",
    shareId: string,
  ): InvestmentTransaction[] {
    const state = transactionsByRequirement[requirementId];
    if (!state || state.status !== "loaded") return [];
    return state.transactions.filter((t) => t.partyType === partyType && t.shareId === shareId);
  }

  function openRecordPaymentDialog(
    requirementId: string,
    partyType: "partner" | "sub_partner",
    shareId: string,
    personName: string,
  ) {
    setRecordPaymentTarget({ requirementId, partyType, shareId, personName });
    setRecordAmount("");
    setRecordDate("");
    setRecordPaymentMode("cash");
    setRecordReferenceNumber("");
    setRecordNotes("");
    setRecordFormError(null);
    // A fresh key for this new logical submission -- see the state's own doc comment.
    setRecordIdempotencyKey(crypto.randomUUID());
  }

  function closeRecordPaymentDialog() {
    setRecordPaymentTarget(null);
  }

  /**
   * Saves a Paid Now transaction (Story 3.3) -- Owner/Admin-facing only, per
   * this story's Decisions (no self-service UI yet). On success, refreshes
   * the recorded-payments list for this requirement so the new payment shows
   * up immediately in the same panel.
   *
   * Passes `recordIdempotencyKey` through unchanged -- it's minted once, when
   * the dialog opens (`openRecordPaymentDialog`), not here. A retry of a
   * failed submission (the user clicking Save again with the dialog still
   * open) reuses that same key, so a real double-submit is deduped
   * server-side rather than creating two rows.
   */
  async function handleRecordPaymentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recordPaymentTarget) return;

    setRecordFormError(null);
    setRecordSubmitting(true);
    try {
      await recordInvestmentTransaction(
        projectId,
        recordPaymentTarget.requirementId,
        {
          partyType: recordPaymentTarget.partyType,
          shareId: recordPaymentTarget.shareId,
          amount: recordAmount,
          transactionDate: recordDate,
          paymentMode: recordPaymentMode,
          referenceNumber: recordReferenceNumber.trim().length > 0 ? recordReferenceNumber.trim() : null,
          notes: recordNotes.trim().length > 0 ? recordNotes.trim() : null,
        },
        recordIdempotencyKey,
      );
    } catch (err) {
      setRecordFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setRecordSubmitting(false);
      return;
    }

    setRecordSubmitting(false);
    const requirementId = recordPaymentTarget.requirementId;
    closeRecordPaymentDialog();
    // `refreshTransactions`/`refreshAdjustments` both catch their own errors
    // -- a failed refresh just leaves the recorded-payments list/adjustment
    // chips showing their prior (stale) state, the same best-effort
    // convention `handleSubmit` above uses for `refresh()`. Adjustments are
    // re-fetched too (not just transactions) so the chip reflects the new
    // Actual Paid total immediately, matching this story's "a new
    // transaction is recorded between two views" I/O case.
    await Promise.all([refreshTransactions(requirementId), refreshAdjustments(requirementId)]);
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
                const adjustmentsState = adjustmentsByRequirement[requirement.id];

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
                                      <div className="ml-1 mt-1">
                                        <AdjustmentChip
                                          adjustment={findPartnerAdjustment(
                                            adjustmentsState,
                                            partner.partnerId,
                                          )}
                                        />
                                      </div>
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
                                      {partner.recommendedAmount !== undefined ? (
                                        // Story 3.5: carry-forward from the previous round's Pending/
                                        // Extra Paid -- shown alongside the plain Should Pay above
                                        // (never in place of it). `mergeRecommendedAmounts` (packages/core)
                                        // already leaves this `undefined` when it numerically equals the
                                        // plain Should Pay, so no client-side comparison is needed here.
                                        <p className="ml-1 mt-1 text-[12.6px] font-semibold text-ink-soft">
                                          Recommended: <Amount value={partner.recommendedAmount} size="sm" />
                                        </p>
                                      ) : null}
                                      <p className="ml-1 mt-1 text-[11.6px] text-ink-faint">
                                        Share {formatSharePercent(partner.sharePercent)}% means if the
                                        project needs <Amount value={requirement.amount} size="sm" />,{" "}
                                        {partner.name}&apos;s normal share is{" "}
                                        <Amount value={partner.ownShouldPay} size="sm" />.
                                      </p>

                                      {/* Story 3.3: Owner/Admin-facing only (this story's Decisions --
                                          no self-service UI yet), so this button is shown unconditionally
                                          here rather than gated by role -- the API itself enforces
                                          self-access vs. Owner/Admin, this page is only ever reached by
                                          an Owner/Admin route in the current nav (Epic 5 builds the
                                          self-service equivalent). */}
                                      <div className="ml-1 mt-1.5">
                                        <Button
                                          variant="ghost"
                                          onClick={() =>
                                            openRecordPaymentDialog(
                                              requirement.id,
                                              "partner",
                                              partner.partnerId,
                                              partner.name,
                                            )
                                          }
                                        >
                                          Record Payment
                                        </Button>
                                      </div>
                                      <RecordedPayments
                                        transactions={recordedPaymentsFor(
                                          requirement.id,
                                          "partner",
                                          partner.partnerId,
                                        )}
                                      />

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
                                                action={<Amount value={sub.shouldPay} size="sm" />}
                                              />
                                              <div className="ml-1 mt-1">
                                                <AdjustmentChip
                                                  adjustment={findSubPartnerAdjustment(
                                                    adjustmentsState,
                                                    partner.partnerId,
                                                    sub.subPartnerId,
                                                  )}
                                                />
                                              </div>
                                              {sub.recommendedAmount !== undefined ? (
                                                <p className="ml-1 mt-1 text-[12.6px] font-semibold text-ink-soft">
                                                  Recommended: <Amount value={sub.recommendedAmount} size="sm" />
                                                </p>
                                              ) : null}
                                              <div className="ml-1 mt-1.5">
                                                <Button
                                                  variant="ghost"
                                                  onClick={() =>
                                                    openRecordPaymentDialog(
                                                      requirement.id,
                                                      "sub_partner",
                                                      sub.subPartnerId,
                                                      sub.name,
                                                    )
                                                  }
                                                >
                                                  Record Payment
                                                </Button>
                                              </div>
                                              <RecordedPayments
                                                transactions={recordedPaymentsFor(
                                                  requirement.id,
                                                  "sub_partner",
                                                  sub.subPartnerId,
                                                )}
                                              />
                                            </div>
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

      <Dialog
        open={recordPaymentTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeRecordPaymentDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>
            Record Payment{recordPaymentTarget ? ` — ${recordPaymentTarget.personName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Owner/Admin only. Saved with an audit record -- a past payment is never edited here.
          </DialogDescription>
          <form onSubmit={handleRecordPaymentSubmit} className="mt-4">
            <Field>
              <Label htmlFor="tx-amount">Amount</Label>
              <Input
                id="tx-amount"
                name="amount"
                inputMode="decimal"
                value={recordAmount}
                onChange={(event) => setRecordAmount(event.target.value)}
                required
                autoFocus
              />
              <Helper>0 is accepted -- no minimum payment enforced.</Helper>
            </Field>
            <Field>
              <Label htmlFor="tx-date">Date</Label>
              <Input
                id="tx-date"
                name="transactionDate"
                type="date"
                value={recordDate}
                onChange={(event) => setRecordDate(event.target.value)}
                required
              />
            </Field>
            <Field>
              <Label htmlFor="tx-payment-mode">Payment Mode</Label>
              <select
                id="tx-payment-mode"
                name="paymentMode"
                className="w-full rounded-el border border-border bg-surface px-3 py-2.5 text-[14px] text-ink focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft"
                value={recordPaymentMode}
                onChange={(event) => setRecordPaymentMode(event.target.value as PaymentMode)}
              >
                {PAYMENT_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <Label htmlFor="tx-reference">Reference Number</Label>
              <Input
                id="tx-reference"
                name="referenceNumber"
                value={recordReferenceNumber}
                onChange={(event) => setRecordReferenceNumber(event.target.value)}
              />
              <Helper>Optional -- e.g. a cash payment often has none.</Helper>
            </Field>
            <Field>
              <Label htmlFor="tx-notes">Notes</Label>
              <Input
                id="tx-notes"
                name="notes"
                value={recordNotes}
                onChange={(event) => setRecordNotes(event.target.value)}
              />
            </Field>

            {recordFormError ? (
              <p role="alert" className="mb-4 text-[13.4px] text-danger">
                {recordFormError}
              </p>
            ) : null}

            <div className="flex gap-2.5">
              <Button type="submit" disabled={recordSubmitting}>
                {recordSubmitting ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={closeRecordPaymentDialog}
                disabled={recordSubmitting}
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

type AdjustmentChipInfo = Pick<PartnerInvestmentAdjustment, "adjustmentType" | "adjustmentAmount">;

/** Finds a Partner's Adjustment status (Story 3.4) in an already-loaded `AdjustmentsState` -- `null` if not loaded yet, errored, or (defensively) not found. */
function findPartnerAdjustment(
  state: AdjustmentsState | undefined,
  partnerId: string,
): AdjustmentChipInfo | null {
  if (!state || state.status !== "loaded") return null;
  return state.partners.find((partner) => partner.partnerId === partnerId) ?? null;
}

/** Finds a Sub-partner's Adjustment status (Story 3.4) nested under its parent Partner -- mirrors `findPartnerAdjustment` one level down. */
function findSubPartnerAdjustment(
  state: AdjustmentsState | undefined,
  partnerId: string,
  subPartnerId: string,
): AdjustmentChipInfo | null {
  if (!state || state.status !== "loaded") return null;
  const partner = state.partners.find((candidate) => candidate.partnerId === partnerId);
  return partner?.subPartners.find((sub) => sub.subPartnerId === subPartnerId) ?? null;
}

const ADJUSTMENT_LABEL: Record<AdjustmentChipInfo["adjustmentType"], string> = {
  extra_paid: "Extra Paid",
  pending: "Pending",
  none: "No Adjustment",
};

/** epic-3-context.md's UX note verbatim: "success" for Extra Paid, "danger" for Pending, neutral for No Adjustment. */
const ADJUSTMENT_VARIANT: Record<AdjustmentChipInfo["adjustmentType"], StatusChipVariant> = {
  extra_paid: "success",
  pending: "danger",
  none: "neutral",
};

/**
 * The Investment Adjustment status chip (Story 3.4) shown per Partner/
 * Sub-partner row once the panel's `adjustments` fetch resolves -- reuses
 * `packages/ui`'s `StatusChip`, always paired with a text label (and, for
 * Pending/Extra Paid, the amount) rather than color alone. Renders nothing
 * while the panel's adjustments fetch hasn't loaded yet (or errored) --
 * Should Pay/Record Payment/recorded payments above it stay fully
 * functional either way (this story's Boundaries: never breaking Story
 * 3.2/3.3's existing panel behavior).
 */
function AdjustmentChip({ adjustment }: { adjustment: AdjustmentChipInfo | null }) {
  if (!adjustment) return null;
  return (
    <StatusChip variant={ADJUSTMENT_VARIANT[adjustment.adjustmentType]}>
      {ADJUSTMENT_LABEL[adjustment.adjustmentType]}
      {adjustment.adjustmentType !== "none" ? (
        <>
          {" "}
          <Amount value={adjustment.adjustmentAmount} size="sm" />
        </>
      ) : null}
    </StatusChip>
  );
}

/**
 * The recorded-payments list shown under a Partner/Sub-partner's Should Pay
 * row once transactions exist for them against this requirement (Story
 * 3.3's Code Map) -- Date, Amount, Payment Mode, nothing more. Renders
 * nothing when there's nothing to show (no fetch-state handling here --
 * `recordedPaymentsFor` already resolves "not loaded yet" to `[]`).
 */
function RecordedPayments({ transactions }: { transactions: InvestmentTransaction[] }) {
  if (transactions.length === 0) {
    return null;
  }
  return (
    <div className="ml-1 mt-1.5 flex flex-col gap-1">
      {transactions.map((transaction) => (
        <div key={transaction.id} className="flex items-center gap-2 text-[11.6px] text-ink-soft">
          <span>{transaction.transactionDate}</span>
          <Amount value={transaction.amount} size="sm" />
          <span>{PAYMENT_MODE_LABELS[transaction.paymentMode]}</span>
        </div>
      ))}
    </div>
  );
}
