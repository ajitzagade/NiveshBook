"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import {
  Wallet,
  Plus,
  ChevronUp,
  Calculator,
  Save,
  X,
  Ban,
  ArrowLeft,
  Pencil,
  ArrowLeftRight,
} from "lucide-react";
import type {
  InvestmentRequirement,
  InvestmentTransaction,
  MoneyMovement,
  PaymentMode,
} from "@niveshbook/types";
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
  EmptyState,
  Field,
  Helper,
  Input,
  Label,
  PageHeader,
  ShareList,
  ShareRow,
  StatusChip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  Th,
  Td,
  toast,
  formatAmount,
  type StatusChipVariant,
} from "@niveshbook/ui";
import { listInvestmentRequirements, addInvestmentRequirement } from "@/lib/investment-requirements";
import { getShouldPay } from "@/lib/should-pay";
import {
  cancelInvestmentTransaction,
  editInvestmentTransaction,
  listInvestmentTransactions,
  recordInvestmentTransaction,
} from "@/lib/investment-transactions";
import { getInvestmentAdjustments } from "@/lib/investment-adjustments";
import { listMoneyMovements } from "@/lib/money-movements";
import { listProjects } from "@/lib/projects";

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
 * Story 3.7: the transaction currently open in the Edit Payment dialog --
 * unlike `RecordPaymentTarget` (identified by `partyType`+`shareId`, since
 * nothing exists yet to edit), this is identified by the specific
 * `transaction` being corrected, plus the `requirementId` it belongs to
 * (needed to build the `PATCH` URL and to refresh the right panel on save).
 */
interface EditPaymentTarget {
  requirementId: string;
  transaction: InvestmentTransaction;
}

/**
 * Story 3.8: the transaction currently pending confirmation in the Cancel
 * Payment dialog -- mirrors `EditPaymentTarget`'s exact shape one dialog
 * over (identified by the specific `transaction` being cancelled, plus the
 * `requirementId` it belongs to).
 */
interface CancelPaymentTarget {
  requirementId: string;
  transaction: InvestmentTransaction;
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
  // 2026-09-25: the summary-confirm step's own open/closed state -- see
  // `handleSubmit`'s doc comment below for why this exists.
  const [requirementConfirmOpen, setRequirementConfirmOpen] = useState(false);

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
  const [recordConfirmOpen, setRecordConfirmOpen] = useState(false);
  // Minted once per *logical* submission attempt (when the dialog opens),
  // never inside the submit handler -- a retry after a failure (same dialog
  // still open) reuses this same key, so a real double-submit is actually
  // deduped server-side (AD-5/AC4). Only closing and reopening the dialog
  // (or a successful save, which closes it) mints a new one.
  const [recordIdempotencyKey, setRecordIdempotencyKey] = useState("");

  // Story 3.7: the Edit Payment dialog -- mirrors the Record Payment state
  // above field-for-field, plus `editIdempotencyKey` following the exact
  // same mint-once-per-logical-submission-attempt lifecycle as
  // `recordIdempotencyKey`.
  const [editPaymentTarget, setEditPaymentTarget] = useState<EditPaymentTarget | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editPaymentMode, setEditPaymentMode] = useState<PaymentMode>("cash");
  const [editReferenceNumber, setEditReferenceNumber] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editFormError, setEditFormError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editIdempotencyKey, setEditIdempotencyKey] = useState("");
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);

  // Story 3.8: the Cancel Payment confirmation dialog -- no editable fields
  // (cancelling never changes amount/date/paymentMode/etc.), so this state
  // is narrower than Record/Edit Payment's -- just the target, an error
  // slot, a submitting flag, and `cancelIdempotencyKey` following the exact
  // same mint-once-per-logical-attempt lifecycle as `editIdempotencyKey`.
  const [cancelPaymentTarget, setCancelPaymentTarget] = useState<CancelPaymentTarget | null>(null);
  const [cancelFormError, setCancelFormError] = useState<string | null>(null);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelIdempotencyKey, setCancelIdempotencyKey] = useState("");

  // Story 4.8 (FR28): every money movement that landed at THIS Project,
  // keyed by its `destinationInvestmentTransactionId` -- drives the
  // "Moved from Project A" indicator (`RecordedPayments` below) on a
  // recorded-payment row that's actually a Story 4.8 auto-created movement,
  // not a manually recorded payment. Best-effort, secondary enrichment
  // (mirrors `adjustmentsByRequirement`'s identical "never blocks the rest
  // of the page" convention) -- fetched once on mount, alongside every
  // other Owner/Admin-only read this page already makes.
  const [moneyMovementsByTransactionId, setMoneyMovementsByTransactionId] = useState<
    Record<string, MoneyMovement>
  >({});
  // The source Project's *name* for that same indicator ("Moved from
  // <name>") -- `listProjects` is already Owner/Admin-only
  // (`"projects:list"`), matching every other fetch this already-Owner/
  // Admin-only page makes, so no new privacy surface.
  const [projectNamesById, setProjectNamesById] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    Promise.all([listMoneyMovements(projectId), listProjects()])
      .then(([movementsResult, projects]) => {
        if (cancelled) return;
        const byTransactionId: Record<string, MoneyMovement> = {};
        for (const movement of movementsResult.moneyMovements) {
          byTransactionId[movement.destinationInvestmentTransactionId] = movement;
        }
        setMoneyMovementsByTransactionId(byTransactionId);
        setProjectNamesById(Object.fromEntries(projects.map((project) => [project.id, project.name])));
      })
      .catch(() => {
        // Best-effort only -- a failed fetch here just means no "Moved from"
        // indicators show, never a blocking page error (mirrors this page's
        // own `refreshAdjustments` convention above).
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
    setRecordConfirmOpen(false);
    // A fresh key for this new logical submission -- see the state's own doc comment.
    setRecordIdempotencyKey(crypto.randomUUID());
  }

  function closeRecordPaymentDialog() {
    setRecordPaymentTarget(null);
  }

  /**
   * The form's own `onSubmit` -- opens the summary-confirm step rather than
   * submitting directly (see `handleSubmit`'s doc comment above for why).
   * The actual `recordInvestmentTransaction` call moved to
   * `handleConfirmRecordPayment` below.
   */
  function handleRecordPaymentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recordPaymentTarget) return;
    setRecordFormError(null);
    setRecordConfirmOpen(true);
  }

  /**
   * Saves a Paid Now transaction (Story 3.3) -- Owner/Admin-facing only, per
   * this story's Decisions (no self-service UI yet). On success, refreshes
   * the recorded-payments list for this requirement so the new payment shows
   * up immediately in the same panel.
   *
   * Passes `recordIdempotencyKey` through unchanged -- it's minted once, when
   * the dialog opens (`openRecordPaymentDialog`), not here. A retry of a
   * failed submission (the user re-confirming with the dialog still open)
   * reuses that same key, so a real double-submit is deduped server-side
   * rather than creating two rows.
   */
  async function handleConfirmRecordPayment() {
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
      toast.success(`${formatAmount(recordAmount)} recorded for ${recordPaymentTarget.personName}`);
    } catch (err) {
      setRecordFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setRecordSubmitting(false);
      return;
    }

    setRecordSubmitting(false);
    const requirementId = recordPaymentTarget.requirementId;
    setRecordConfirmOpen(false);
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

  /** Opens the Edit Payment dialog, pre-filled with `transaction`'s current values (Story 3.7) -- Owner/Admin-facing only, mirroring `openRecordPaymentDialog`'s Decisions one dialog over. */
  function openEditPaymentDialog(requirementId: string, transaction: InvestmentTransaction) {
    setEditPaymentTarget({ requirementId, transaction });
    setEditAmount(transaction.amount);
    setEditDate(transaction.transactionDate);
    setEditPaymentMode(transaction.paymentMode);
    setEditReferenceNumber(transaction.referenceNumber ?? "");
    setEditNotes(transaction.notes ?? "");
    setEditFormError(null);
    setEditConfirmOpen(false);
    // A fresh key for this new logical edit attempt -- mirrors `recordIdempotencyKey`'s own doc comment.
    setEditIdempotencyKey(crypto.randomUUID());
  }

  function closeEditPaymentDialog() {
    setEditPaymentTarget(null);
  }

  /**
   * The form's own `onSubmit` -- opens the summary-confirm step rather than
   * submitting directly (see `handleSubmit`'s doc comment above). The
   * actual `editInvestmentTransaction` call moved to
   * `handleConfirmEditPayment` below.
   */
  function handleEditPaymentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editPaymentTarget) return;
    setEditFormError(null);
    setEditConfirmOpen(true);
  }

  /**
   * Saves a corrected transaction (Story 3.7, FR41) -- Owner/Admin-only, no
   * new recompute call needed: Story 3.4's Investment Adjustment already
   * sums each transaction's *current* amount on every view, so refreshing
   * the adjustment chip below (the same `refreshAdjustments` Record Payment
   * already uses) is sufficient to reflect the correction, with zero new
   * client-side logic either.
   *
   * Passes `editIdempotencyKey` through unchanged -- minted once, when the
   * dialog opens (`openEditPaymentDialog`), not here -- mirrors
   * `handleConfirmRecordPayment`'s identical retry-reuses-the-same-key
   * contract.
   */
  async function handleConfirmEditPayment() {
    if (!editPaymentTarget) return;

    setEditFormError(null);
    setEditSubmitting(true);
    try {
      await editInvestmentTransaction(
        projectId,
        editPaymentTarget.requirementId,
        editPaymentTarget.transaction.id,
        {
          amount: editAmount,
          transactionDate: editDate,
          paymentMode: editPaymentMode,
          referenceNumber: editReferenceNumber.trim().length > 0 ? editReferenceNumber.trim() : null,
          notes: editNotes.trim().length > 0 ? editNotes.trim() : null,
          reason: null,
        },
        editIdempotencyKey,
      );
      toast.success(`Payment updated to ${formatAmount(editAmount)}`);
    } catch (err) {
      setEditFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setEditSubmitting(false);
      return;
    }

    setEditSubmitting(false);
    const requirementId = editPaymentTarget.requirementId;
    setEditConfirmOpen(false);
    closeEditPaymentDialog();
    // Best-effort, mirroring `handleRecordPaymentSubmit`'s identical convention.
    await Promise.all([refreshTransactions(requirementId), refreshAdjustments(requirementId)]);
  }

  /**
   * Opens the Cancel Payment confirmation dialog for `transaction` (Story
   * 3.8, FR42) -- Owner/Admin-facing only, mirroring `openEditPaymentDialog`'s
   * Decisions one dialog over. A confirmation step precedes the actual
   * `cancelInvestmentTransaction` call (`handleCancelPaymentConfirm` below)
   * -- this feels destructive to a user even though nothing is hard-deleted
   * (a linked reversal record is created instead, FR42).
   */
  function openCancelPaymentDialog(requirementId: string, transaction: InvestmentTransaction) {
    setCancelPaymentTarget({ requirementId, transaction });
    setCancelFormError(null);
    // A fresh key for this new logical cancel attempt -- mirrors `editIdempotencyKey`'s own doc comment.
    setCancelIdempotencyKey(crypto.randomUUID());
  }

  function closeCancelPaymentDialog() {
    setCancelPaymentTarget(null);
  }

  /**
   * Confirms and performs the cancel (Story 3.8, FR42) -- no form fields to
   * validate (cancelling never changes amount/date/paymentMode/etc.), so
   * this is a plain confirm handler, not a form `onSubmit`. No new recompute
   * call needed here either, for the identical reason `handleEditPaymentSubmit`
   * needs none: `refreshAdjustments` (the same call Record/Edit Payment
   * already use) re-fetches Story 3.4's Investment Adjustment, which now
   * excludes the cancelled amount via the *route's* `filterActiveTransactions`
   * step -- zero new client-side logic.
   */
  async function handleCancelPaymentConfirm() {
    if (!cancelPaymentTarget) return;

    setCancelFormError(null);
    setCancelSubmitting(true);
    try {
      await cancelInvestmentTransaction(
        projectId,
        cancelPaymentTarget.requirementId,
        cancelPaymentTarget.transaction.id,
        null,
        cancelIdempotencyKey,
      );
      toast.success("Payment cancelled");
    } catch (err) {
      setCancelFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setCancelSubmitting(false);
      return;
    }

    setCancelSubmitting(false);
    const requirementId = cancelPaymentTarget.requirementId;
    closeCancelPaymentDialog();
    // Best-effort, mirroring `handleRecordPaymentSubmit`'s identical convention.
    await Promise.all([refreshTransactions(requirementId), refreshAdjustments(requirementId)]);
  }

  function openAddDialog() {
    setAmount("");
    setRequirementDate("");
    setFormError(null);
    setRequirementConfirmOpen(false);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
  }

  /**
   * 2026-09-25: money-moving/destructive actions on this page (creating a
   * funding requirement, recording/editing/cancelling a payment) now show a
   * summary-confirm step before actually submitting -- mirrors the shape
   * Story 3.8's Cancel Payment dialog and Story 4.5's (in-progress, see
   * `withdraw-money/page.tsx`) Authorize Extra Withdrawal dialog already
   * use: a second `Dialog` stacked on top of the still-open form, no
   * editable fields of its own, "Confirm"/"Back". Low-stakes forms
   * (Project name/description, Partner Share %) deliberately keep saving
   * directly -- this is scoped to money/destructive actions only, per that
   * decision.
   *
   * The form's own `onSubmit` (this handler) now only validates via the
   * browser's native `required` attributes and opens the confirm step --
   * the actual `addInvestmentRequirement` call moved to
   * `handleConfirmAddRequirement` below.
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setRequirementConfirmOpen(true);
  }

  async function handleConfirmAddRequirement() {
    setFormError(null);
    setSubmitting(true);
    try {
      await addInvestmentRequirement(projectId, { amount, requirementDate });
      toast.success(`Funding requirement of ${formatAmount(amount)} created for ${requirementDate}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    // The requirement is already saved at this point -- close both dialogs
    // regardless of whether the follow-up refresh (a separate GET) below
    // succeeds. Story 3.3's idempotency keys don't exist yet, so treating a
    // refresh failure the same as a create failure would show a misleading
    // "save failed" error and could prompt the user to click Save again,
    // creating a genuine duplicate requirement.
    setSubmitting(false);
    setRequirementConfirmOpen(false);
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
      <PageHeader
        backHref="/projects"
        backLabel="Projects"
        title="Add Money"
        description="Create a funding requirement for this Project -- an amount and a date. Every Partner's Should Pay is calculated from this once their Share % is set."
        action={
          <Button onClick={openAddDialog} icon={<Plus size={14} />}>
            New Requirement
          </Button>
        }
      />

      <Card>
        {state.status === "loading" ? (
          <p className="text-[13.4px] text-ink-soft">Loading funding requirements…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.requirements.length === 0 ? (
          <EmptyState
            icon={<Wallet size={22} />}
            title="No funding requirements yet"
            description="Create the first one to get started -- an amount and a date is all it takes."
            action={
              <Button variant="ghost" onClick={openAddDialog} icon={<Plus size={14} />}>
                New Requirement
              </Button>
            }
          />
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
                          icon={expanded ? <ChevronUp size={14} /> : <Calculator size={14} />}
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
                                          icon={<Wallet size={14} />}
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
                                        movementsByTransactionId={moneyMovementsByTransactionId}
                                        projectNamesById={projectNamesById}
                                        onEdit={(transaction) =>
                                          openEditPaymentDialog(requirement.id, transaction)
                                        }
                                        onCancel={(transaction) =>
                                          openCancelPaymentDialog(requirement.id, transaction)
                                        }
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
                                                  icon={<Wallet size={14} />}
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
                                                movementsByTransactionId={moneyMovementsByTransactionId}
                                                projectNamesById={projectNamesById}
                                                onEdit={(transaction) =>
                                                  openEditPaymentDialog(requirement.id, transaction)
                                                }
                                                onCancel={(transaction) =>
                                                  openCancelPaymentDialog(requirement.id, transaction)
                                                }
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
              <Button type="submit" disabled={submitting} icon={<Save size={14} />}>
                Save
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

      <Dialog
        open={requirementConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setRequirementConfirmOpen(false);
        }}
      >
        <DialogContent>
          <DialogTitle>Confirm Funding Requirement</DialogTitle>
          <DialogDescription>
            Create a funding requirement of <strong>{formatAmount(amount)}</strong> for{" "}
            <strong>{requirementDate}</strong>? Each funding round is its own new record -- a past
            requirement is never edited.
          </DialogDescription>

          {formError ? (
            <p role="alert" className="mt-4 text-[13.4px] text-danger">
              {formError}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2.5">
            <Button
              type="button"
              onClick={handleConfirmAddRequirement}
              disabled={submitting}
              icon={<Save size={14} />}
            >
              {submitting ? "Saving…" : "Confirm"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRequirementConfirmOpen(false)}
              disabled={submitting}
              icon={<ArrowLeft size={14} />}
            >
              Back
            </Button>
          </div>
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
              <Button type="submit" disabled={recordSubmitting} icon={<Save size={14} />}>
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={closeRecordPaymentDialog}
                disabled={recordSubmitting}
                icon={<X size={14} />}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={recordConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setRecordConfirmOpen(false);
        }}
      >
        <DialogContent>
          <DialogTitle>Confirm Payment</DialogTitle>
          <DialogDescription>
            Record <strong>{formatAmount(recordAmount)}</strong> for{" "}
            <strong>{recordPaymentTarget?.personName}</strong>, paid on{" "}
            <strong>{recordDate}</strong> via <strong>{PAYMENT_MODE_LABELS[recordPaymentMode]}</strong>
            {recordReferenceNumber.trim() ? (
              <>
                {" "}
                (Ref: <strong>{recordReferenceNumber.trim()}</strong>)
              </>
            ) : null}
            ? Saved with an audit record -- a past payment is never edited here.
          </DialogDescription>

          {recordFormError ? (
            <p role="alert" className="mt-4 text-[13.4px] text-danger">
              {recordFormError}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2.5">
            <Button
              type="button"
              onClick={handleConfirmRecordPayment}
              disabled={recordSubmitting}
              icon={<Save size={14} />}
            >
              {recordSubmitting ? "Saving…" : "Confirm"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRecordConfirmOpen(false)}
              disabled={recordSubmitting}
              icon={<ArrowLeft size={14} />}
            >
              Back
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editPaymentTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeEditPaymentDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>Edit Payment</DialogTitle>
          <DialogDescription>
            Owner/Admin only. The previous values, who changed it, and when, are preserved in the audit
            trail (FR41) -- this updates the recorded payment in place, it never creates a new row.
          </DialogDescription>
          <form onSubmit={handleEditPaymentSubmit} className="mt-4">
            <Field>
              <Label htmlFor="edit-tx-amount">Amount</Label>
              <Input
                id="edit-tx-amount"
                name="amount"
                inputMode="decimal"
                value={editAmount}
                onChange={(event) => setEditAmount(event.target.value)}
                required
                autoFocus
              />
              <Helper>0 is accepted -- no minimum payment enforced.</Helper>
            </Field>
            <Field>
              <Label htmlFor="edit-tx-date">Date</Label>
              <Input
                id="edit-tx-date"
                name="transactionDate"
                type="date"
                value={editDate}
                onChange={(event) => setEditDate(event.target.value)}
                required
              />
            </Field>
            <Field>
              <Label htmlFor="edit-tx-payment-mode">Payment Mode</Label>
              <select
                id="edit-tx-payment-mode"
                name="paymentMode"
                className="w-full rounded-el border border-border bg-surface px-3 py-2.5 text-[14px] text-ink focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft"
                value={editPaymentMode}
                onChange={(event) => setEditPaymentMode(event.target.value as PaymentMode)}
              >
                {PAYMENT_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <Label htmlFor="edit-tx-reference">Reference Number</Label>
              <Input
                id="edit-tx-reference"
                name="referenceNumber"
                value={editReferenceNumber}
                onChange={(event) => setEditReferenceNumber(event.target.value)}
              />
              <Helper>Optional -- e.g. a cash payment often has none.</Helper>
            </Field>
            <Field>
              <Label htmlFor="edit-tx-notes">Notes</Label>
              <Input
                id="edit-tx-notes"
                name="notes"
                value={editNotes}
                onChange={(event) => setEditNotes(event.target.value)}
              />
            </Field>

            {editFormError ? (
              <p role="alert" className="mb-4 text-[13.4px] text-danger">
                {editFormError}
              </p>
            ) : null}

            <div className="flex gap-2.5">
              <Button type="submit" disabled={editSubmitting} icon={<Save size={14} />}>
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={closeEditPaymentDialog}
                disabled={editSubmitting}
                icon={<X size={14} />}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setEditConfirmOpen(false);
        }}
      >
        <DialogContent>
          <DialogTitle>Confirm Changes</DialogTitle>
          <DialogDescription>
            Update this payment to <strong>{formatAmount(editAmount)}</strong> on{" "}
            <strong>{editDate}</strong> via <strong>{PAYMENT_MODE_LABELS[editPaymentMode]}</strong>
            {editReferenceNumber.trim() ? (
              <>
                {" "}
                (Ref: <strong>{editReferenceNumber.trim()}</strong>)
              </>
            ) : null}
            ? The previous values, who changed it, and when, are preserved in the audit trail (FR41).
          </DialogDescription>

          {editFormError ? (
            <p role="alert" className="mt-4 text-[13.4px] text-danger">
              {editFormError}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2.5">
            <Button
              type="button"
              onClick={handleConfirmEditPayment}
              disabled={editSubmitting}
              icon={<Save size={14} />}
            >
              {editSubmitting ? "Saving…" : "Confirm"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditConfirmOpen(false)}
              disabled={editSubmitting}
              icon={<ArrowLeft size={14} />}
            >
              Back
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cancelPaymentTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeCancelPaymentDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>Cancel this payment?</DialogTitle>
          <DialogDescription>
            {cancelPaymentTarget ? (
              <>
                Cancel the{" "}
                <strong>{formatAmount(cancelPaymentTarget.transaction.amount)}</strong> payment from{" "}
                <strong>{cancelPaymentTarget.transaction.transactionDate}</strong> (
                {PAYMENT_MODE_LABELS[cancelPaymentTarget.transaction.paymentMode]})?{" "}
              </>
            ) : null}
            Owner/Admin only. The original record is preserved with a &quot;Cancelled&quot; status and a
            linked reversal record is created (FR42) -- nothing is deleted, but the amount stops counting
            toward Paid Now the next time the Adjustment ledger is viewed.
          </DialogDescription>

          {cancelFormError ? (
            <p role="alert" className="mt-4 text-[13.4px] text-danger">
              {cancelFormError}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2.5">
            <Button
              type="button"
              onClick={handleCancelPaymentConfirm}
              disabled={cancelSubmitting}
              icon={<Ban size={14} />}
            >
              {cancelSubmitting ? "Cancelling…" : "Confirm Cancel"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={closeCancelPaymentDialog}
              disabled={cancelSubmitting}
              icon={<ArrowLeft size={14} />}
            >
              Back
            </Button>
          </div>
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
 * 3.3's Code Map) -- Date, Amount, Payment Mode, plus an "Edit" affordance
 * per row (Story 3.7, Owner/Admin-facing only, matching Record Payment's own
 * unconditional-here-since-the-API-itself-gates precedent immediately
 * above). Renders nothing when there's nothing to show (no fetch-state
 * handling here -- `recordedPaymentsFor` already resolves "not loaded yet"
 * to `[]`).
 *
 * Story 3.8 (FR42) adds a "Cancelled" `StatusChip` (reusing `packages/ui`'s
 * component, per this story's Code Map) for any row whose `status` is
 * already `"cancelled"` -- both the original (now-voided) row and its
 * linked reversal row show it, since both carry `status: "cancelled"`; the
 * reversal row is additionally labeled "(reversal)" so the two are never
 * confused with each other in this list (FR42's "self-explanatory audit
 * trail"). Both the "Edit" and "Cancel" affordances are hidden entirely for
 * a row that's already cancelled -- there's nothing left to edit or cancel
 * (spec-3-8's Review Triage Log, row 2: "Edit" was initially left
 * unconditional, letting a user open the Edit dialog for an
 * already-cancelled/reversal row and only discover the 409 on save; it now
 * mirrors "Cancel"'s gate exactly) -- and, like every affordance on this
 * page, is Owner/Admin-facing only (the API itself gates the rest).
 *
 * Story 4.8 (FR28) adds a "Moved from Project A" `StatusChip` for any row
 * whose `id` matches a fetched `money_movements` entry's
 * `destinationInvestmentTransactionId` -- an auto-created linked investment
 * record from a cross-project withdrawal allocation, not a manually recorded
 * payment (AC2's "data-level reachable/navigable" requirement; a full
 * clickable trail is Epic 5's job). `info`/teal, per epic-4-context.md's UX
 * convention ("info/teal marks a cross-project money movement"). Falls back
 * to "Moved from another Project" if `listProjects()` resolved without that
 * specific source Project's own entry. If the mount-time fetch fails
 * entirely (either `listMoneyMovements`/`listProjects` rejects --
 * `Promise.all(...)` requires both to succeed before either indicator-state
 * setter runs), this indicator shows nothing at all for every row rather
 * than a partial/fallback state -- best-effort, never blocks the rest of
 * the page.
 */
function RecordedPayments({
  transactions,
  movementsByTransactionId,
  projectNamesById,
  onEdit,
  onCancel,
}: {
  transactions: InvestmentTransaction[];
  movementsByTransactionId: Record<string, MoneyMovement>;
  projectNamesById: Record<string, string>;
  onEdit: (transaction: InvestmentTransaction) => void;
  onCancel: (transaction: InvestmentTransaction) => void;
}) {
  if (transactions.length === 0) {
    return null;
  }
  return (
    <div className="ml-1 mt-1.5 flex flex-col gap-1">
      {transactions.map((transaction) => {
        const movement = movementsByTransactionId[transaction.id];
        return (
        <div key={transaction.id} className="flex items-center gap-2 text-[11.6px] text-ink-soft">
          <span>{transaction.transactionDate}</span>
          <Amount value={transaction.amount} size="sm" />
          <span>{PAYMENT_MODE_LABELS[transaction.paymentMode]}</span>
          {movement ? (
            <StatusChip variant="info">
              <ArrowLeftRight size={11} /> Moved from{" "}
              {projectNamesById[movement.sourceProjectId] ?? "another Project"}
            </StatusChip>
          ) : null}
          {transaction.status === "cancelled" ? (
            <StatusChip variant="danger">
              Cancelled{transaction.reversalOfTransactionId ? " (reversal)" : ""}
            </StatusChip>
          ) : null}
          {transaction.status === "active" ? (
            <Button variant="ghost" onClick={() => onEdit(transaction)} icon={<Pencil size={12} />}>
              Edit
            </Button>
          ) : null}
          {transaction.status === "active" ? (
            <Button variant="ghost" onClick={() => onCancel(transaction)} icon={<Ban size={12} />}>
              Cancel
            </Button>
          ) : null}
        </div>
        );
      })}
    </div>
  );
}
