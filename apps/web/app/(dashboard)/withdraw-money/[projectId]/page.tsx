"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeftRight, Save, X } from "lucide-react";
import type { PaymentMode } from "@niveshbook/types";
import {
  Amount,
  amountInWords,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Field,
  formatAmount,
  formatDate,
  Helper,
  Input,
  Label,
  PageHeader,
  StatCard,
  toast,
} from "@niveshbook/ui";
import { getOwnershipStructure } from "@/lib/ownership-structure";
import { getMyWithdrawalStatus, type MyWithdrawalStatusResponse } from "@/lib/my-withdrawal-status";
import { recordWithdrawalTransaction } from "@/lib/withdrawal-transactions";

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

type PartyType = "partner" | "sub_partner";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; projectName: string; withdrawal: MyWithdrawalStatusResponse };

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Live helper text under the Amount field -- mirrors `add-money/[projectId]/page.tsx`'s identical helper. */
function amountHelperText(amount: string): string {
  if (!amount.trim()) return "e.g. 1000000 for ₹10,00,000.";
  const words = amountInWords(amount);
  return words ? `${formatAmount(amount)} (${words})` : formatAmount(amount);
}

/**
 * Partner/Sub-partner self-service Withdraw Money (2026-09-29) -- new,
 * small, standalone page OUTSIDE `/projects/**`, mirroring `add-money/
 * [projectId]/page.tsx`'s just-built shape one ledger over. No page-level
 * `authorize()` call -- every read/write goes through a route that already
 * gates itself (AD-1).
 *
 * Deliberately scoped down from the Owner/Admin Withdraw Money page (3129
 * lines): no "Distribute a Withdrawal" collective multi-partner split, no
 * "Skip this round" reallocation, no destination allocation, no "Authorize
 * Extra Withdrawal" override (that's an Owner/Admin-only escalation, Story
 * 4.5 -- a Partner exceeding their own Can Take simply gets the server's
 * 403 surfaced inline, no special-casing needed, per this feature's plan).
 * Shows the caller's own Can Take / Effective Can Take (Story 4.6's dormant
 * `my-withdrawal-status` endpoint, its first caller -- already includes
 * reallocation bonus/decline math) and a single "Withdraw Money" dialog
 * records a withdrawal against the caller's own share
 * (`withdrawal_transactions:create`, already self-access-capable since
 * Story 4.2).
 */
export default function WithdrawMoneyPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const searchParams = useSearchParams();

  const partnerId = searchParams.get("partnerId");
  const subPartnerId = searchParams.get("subPartnerId");
  const partyType: PartyType | null = partnerId ? "partner" : subPartnerId ? "sub_partner" : null;
  const shareId = partnerId ?? subPartnerId ?? null;

  const [state, setState] = useState<LoadState>({ status: "loading" });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [transactionDate, setTransactionDate] = useState(todayDate());
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function loadWithdrawalStatus(currentPartyType: PartyType, currentShareId: string, cancelledRef: {
    cancelled: boolean;
  }) {
    setState({ status: "loading" });
    try {
      const [structureResult, withdrawalResult] = await Promise.all([
        getOwnershipStructure(projectId, {
          partnerId: partnerId ?? undefined,
          subPartnerId: subPartnerId ?? undefined,
        }),
        getMyWithdrawalStatus(projectId, currentPartyType, currentShareId),
      ]);
      if (!cancelledRef.cancelled) {
        setState({ status: "loaded", projectName: structureResult.projectName, withdrawal: withdrawalResult });
      }
    } catch (error) {
      if (!cancelledRef.cancelled) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Something went wrong.",
        });
      }
    }
  }

  useEffect(() => {
    const cancelledRef = { cancelled: false };
    // Nested inside an async IIFE -- `react-hooks/set-state-in-effect` flags
    // a direct top-level `setState` call in an effect body as if it
    // happened synchronously, even for the "missing reference" branch;
    // mirrors `structure/[projectId]/page.tsx`'s identical precedent.
    void (async () => {
      if (!partyType || !shareId) {
        setState({
          status: "error",
          message: "This link is missing a Partner or Sub-partner reference.",
        });
        return;
      }
      await loadWithdrawalStatus(partyType, shareId, cancelledRef);
    })();
    return () => {
      cancelledRef.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- partyType/shareId are derived from partnerId/subPartnerId, listed separately would be redundant
  }, [projectId, partnerId, subPartnerId]);

  function openDialog() {
    setDialogOpen(true);
    setAmount("");
    setTransactionDate(todayDate());
    setPaymentMode("cash");
    setReferenceNumber("");
    setNotes("");
    setFormError(null);
    setConfirmOpen(false);
    setIdempotencyKey(crypto.randomUUID());
  }

  function closeDialog() {
    setDialogOpen(false);
    setConfirmOpen(false);
  }

  /**
   * Form's own `onSubmit` -- opens the confirm step rather than saving
   * directly (mirrors `add-money/[projectId]/page.tsx`'s identical pattern,
   * itself mirroring the Owner Add Money page's established two-step shape).
   *
   * Also does a friendly, non-authoritative pre-check against this caller's
   * own `effectiveCanTake` (already loaded on this page) so the common
   * "typed one zero too many" case gets an immediate, specific message
   * instead of a round trip to the server's 403 (which, for a Partner/Sub-
   * partner, is a deliberately generic "no permission" string -- see this
   * page's own doc comment on the Authorize Extra Withdrawal gate). The
   * server's own check remains the authoritative one either way (AD-1) --
   * this only ever short-circuits toward a friendlier message, never grants
   * anything the server wouldn't.
   */
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!partyType || !shareId || state.status !== "loaded") return;
    setFormError(null);
    const effectiveCanTake = state.withdrawal.status.effectiveCanTake;
    if (Number(amount) > Number(effectiveCanTake)) {
      setFormError(
        `You've reached your Can Take limit for this Project -- up to ${formatAmount(effectiveCanTake)} is available.`,
      );
      return;
    }
    setConfirmOpen(true);
  }

  async function handleConfirmSave() {
    if (!partyType || !shareId) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await recordWithdrawalTransaction(
        projectId,
        {
          partyType,
          shareId,
          amount,
          transactionDate,
          paymentMode,
          referenceNumber: referenceNumber.trim() ? referenceNumber.trim() : null,
          notes: notes.trim() ? notes.trim() : null,
        },
        idempotencyKey,
      );
      toast.success(`${formatAmount(amount)} withdrawn.`);
      closeDialog();
      await loadWithdrawalStatus(partyType, shareId, { cancelled: false });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (state.status === "loading") {
    return (
      <div>
        <PageHeader title="Withdraw Money" />
        <Card>
          <p className="text-[13.4px] text-ink-soft">Loading…</p>
        </Card>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        <PageHeader title="Withdraw Money" />
        <Card>
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        </Card>
      </div>
    );
  }

  const { projectName, withdrawal } = state;

  return (
    <div>
      <PageHeader title="Withdraw Money" description={`${projectName} -- your own withdrawals.`} />

      <Card>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Can Take" value={withdrawal.status.canTake} tone="danger" />
          <StatCard label="Already Taken" value={withdrawal.status.taken} tone="default" />
          <StatCard label="Can Take now" value={withdrawal.status.effectiveCanTake} tone="success" />
        </div>
        <Button icon={<ArrowLeftRight size={14} />} onClick={openDialog}>
          Withdraw Money
        </Button>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>Withdraw Money</DialogTitle>
          <DialogDescription>
            Record money you took out. Up to <Amount value={withdrawal.status.effectiveCanTake} size="sm" /> is
            available.
          </DialogDescription>
          <form onSubmit={handleSubmit} className="mt-4">
            <Field>
              <Label htmlFor="my-wtx-amount">Amount</Label>
              <Input
                id="my-wtx-amount"
                name="amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
                autoFocus
              />
              <Helper>{amountHelperText(amount)}</Helper>
            </Field>
            <Field>
              <Label htmlFor="my-wtx-date">Date</Label>
              <Input
                id="my-wtx-date"
                name="transactionDate"
                type="date"
                value={transactionDate}
                onChange={(event) => setTransactionDate(event.target.value)}
                required
              />
            </Field>
            <Field>
              <Label htmlFor="my-wtx-payment-mode">Payment Mode</Label>
              <select
                id="my-wtx-payment-mode"
                name="paymentMode"
                value={paymentMode}
                onChange={(event) => setPaymentMode(event.target.value as PaymentMode)}
                className="w-full rounded-el border border-border bg-surface px-3 py-2.5 text-[14px] text-ink focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft"
              >
                {PAYMENT_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <Label htmlFor="my-wtx-reference">Reference Number</Label>
              <Input
                id="my-wtx-reference"
                name="referenceNumber"
                value={referenceNumber}
                onChange={(event) => setReferenceNumber(event.target.value)}
              />
              <Helper>Optional -- e.g. a cash withdrawal often has none.</Helper>
            </Field>
            <Field>
              <Label htmlFor="my-wtx-notes">Notes</Label>
              <Input id="my-wtx-notes" name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            {formError ? (
              <p role="alert" className="mb-4 text-[13.4px] text-danger">
                {formError}
              </p>
            ) : null}
            <div className="flex gap-2.5">
              <Button type="submit" icon={<Save size={14} />}>
                Review &amp; Withdraw
              </Button>
              <Button type="button" variant="ghost" onClick={closeDialog} icon={<X size={14} />}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) setConfirmOpen(false);
        }}
      >
        <DialogContent>
          <DialogTitle>Confirm Withdrawal</DialogTitle>
          <DialogDescription>
            Withdraw <strong>{formatAmount(amount)}</strong>, paid on <strong>{formatDate(transactionDate)}</strong> via{" "}
            <strong>{PAYMENT_MODE_LABELS[paymentMode]}</strong>?
          </DialogDescription>

          {formError ? (
            <p role="alert" className="mt-4 text-[13.4px] text-danger">
              {formError}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2.5">
            <Button type="button" onClick={handleConfirmSave} disabled={submitting} icon={<Save size={14} />}>
              {submitting ? "Saving…" : "Confirm"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
              icon={<X size={14} />}
            >
              Back
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
