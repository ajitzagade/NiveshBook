"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { BanknoteArrowDown, Minus, Save, X } from "lucide-react";
import type { PartnerCanTake } from "@niveshbook/core";
import type { PaymentMode, WithdrawalTransaction } from "@niveshbook/types";
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
  toast,
  formatAmount,
} from "@niveshbook/ui";
import { getCanTake } from "@/lib/can-take";
import {
  listWithdrawalTransactions,
  recordWithdrawalTransaction,
} from "@/lib/withdrawal-transactions";

type CanTakeState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; availableToWithdraw: string; partners: PartnerCanTake[] };

type WithdrawalsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; transactions: WithdrawalTransaction[] };

interface RecordWithdrawalTarget {
  partyType: "partner" | "sub_partner";
  shareId: string;
  personName: string;
}

/**
 * Every valid `PaymentMode`, in display order -- the `Record<PaymentMode, string>`
 * forces this list to stay exhaustive against `packages/types`'s `PaymentMode`
 * union at compile time, mirroring `add-money/page.tsx`'s identical
 * `PAYMENT_MODE_LABELS` precedent. Kept local to this page (this story's Code
 * Map: no route-level `shared.ts` re-export to import instead, closing
 * Review Triage Log row 4).
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
 * Withdraw Money page (Story 4.1, extended by Story 4.2): one page per
 * Project -- displays each current Partner's (and, one level down, each
 * current Sub-partner's) Can Take, computed live from Share % × the
 * Project's available-to-withdraw amount (FR21, AD-2), plus a "Record
 * Withdrawal" dialog per row (Story 4.2) that saves a Take Now transaction
 * with its own audit record (AD-5). Reached from the Projects list page's
 * per-row "Withdraw Money" link, mirroring "Add Money"/"Shares". Covers all
 * 4 NFR8 states (loading/error/empty/loaded), the same data-table-with-
 * sub-rows shape as Partner Shares/Add Money (`ShareRow`, Sub-partners
 * indented one level with `↳`), plus the worked-example hint line matching
 * Should Pay's established copy pattern (EXPERIENCE.md).
 *
 * The recorded-withdrawals list per person is fetched via
 * `listWithdrawalTransactions` on page load (Story 4.2, closing Review
 * Triage Log row 1) -- it persists across reload, mirroring Add Money's
 * `refresh()` pattern, rather than purely client-accumulated state.
 */
export default function WithdrawMoneyPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [state, setState] = useState<CanTakeState>({ status: "loading" });
  const [withdrawalsState, setWithdrawalsState] = useState<WithdrawalsState>({ status: "loading" });

  const [recordTarget, setRecordTarget] = useState<RecordWithdrawalTarget | null>(null);
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
  // deduped server-side (AD-5). Only closing and reopening the dialog (or a
  // successful save, which closes it) mints a new one. Mirrors
  // `add-money/page.tsx`'s `recordIdempotencyKey` exactly.
  const [recordIdempotencyKey, setRecordIdempotencyKey] = useState("");

  async function refreshCanTake() {
    const result = await getCanTake(projectId);
    setState({ status: "loaded", availableToWithdraw: result.availableToWithdraw, partners: result.partners });
  }

  async function refreshWithdrawals() {
    try {
      const result = await listWithdrawalTransactions(projectId);
      setWithdrawalsState({ status: "loaded", transactions: result.transactions });
    } catch (error) {
      setWithdrawalsState({
        status: "error",
        message: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }

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

    listWithdrawalTransactions(projectId)
      .then((result) => {
        if (!cancelled) {
          setWithdrawalsState({ status: "loaded", transactions: result.transactions });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setWithdrawalsState({
            status: "error",
            message: error instanceof Error ? error.message : "Something went wrong.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /** Every withdrawal recorded against `shareId`/`partyType` on this Project, or `[]` if the list hasn't loaded (yet). */
  function recordedWithdrawalsFor(
    partyType: "partner" | "sub_partner",
    shareId: string,
  ): WithdrawalTransaction[] {
    if (withdrawalsState.status !== "loaded") return [];
    return withdrawalsState.transactions.filter(
      (transaction) => transaction.partyType === partyType && transaction.shareId === shareId,
    );
  }

  function openRecordWithdrawalDialog(
    partyType: "partner" | "sub_partner",
    shareId: string,
    personName: string,
  ) {
    setRecordTarget({ partyType, shareId, personName });
    setRecordAmount("");
    setRecordDate("");
    setRecordPaymentMode("cash");
    setRecordReferenceNumber("");
    setRecordNotes("");
    setRecordFormError(null);
    // A fresh key for this new logical submission -- see the state's own doc comment.
    setRecordIdempotencyKey(crypto.randomUUID());
  }

  function closeRecordWithdrawalDialog() {
    setRecordTarget(null);
  }

  /**
   * Saves a Take Now withdrawal (Story 4.2) -- Owner/Admin-facing on anyone's
   * behalf, or a linked Partner/Sub-partner recording their own (self-access,
   * this story's Intent) -- the API itself enforces which. On success,
   * refreshes both Can Take (the newly-recorded withdrawal doesn't change
   * Can Take itself in this story, but keeps the panel consistent with any
   * concurrent change) and the recorded-withdrawals list so the new
   * withdrawal shows up immediately.
   *
   * Passes `recordIdempotencyKey` through unchanged -- it's minted once, when
   * the dialog opens (`openRecordWithdrawalDialog`), not here. A retry of a
   * failed submission (the user clicking Save again with the dialog still
   * open) reuses that same key, so a real double-submit is deduped
   * server-side rather than creating two rows.
   */
  async function handleRecordWithdrawalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recordTarget) return;

    setRecordFormError(null);
    setRecordSubmitting(true);
    try {
      await recordWithdrawalTransaction(
        projectId,
        {
          partyType: recordTarget.partyType,
          shareId: recordTarget.shareId,
          amount: recordAmount,
          transactionDate: recordDate,
          paymentMode: recordPaymentMode,
          referenceNumber:
            recordReferenceNumber.trim().length > 0 ? recordReferenceNumber.trim() : null,
          notes: recordNotes.trim().length > 0 ? recordNotes.trim() : null,
        },
        recordIdempotencyKey,
      );
      toast.success(`${formatAmount(recordAmount)} withdrawal recorded for ${recordTarget.personName}`);
    } catch (err) {
      setRecordFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setRecordSubmitting(false);
      return;
    }

    setRecordSubmitting(false);
    closeRecordWithdrawalDialog();
    // Best-effort, mirroring `add-money/page.tsx`'s identical convention --
    // the withdrawal is already saved server-side either way.
    await Promise.all([
      refreshWithdrawals().catch(() => {}),
      refreshCanTake().catch(() => {}),
    ]);
  }

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

                  <div className="ml-1 mt-1.5">
                    <Button
                      variant="ghost"
                      onClick={() => openRecordWithdrawalDialog("partner", partner.partnerId, partner.name)}
                      icon={<Minus size={14} />}
                    >
                      Record Withdrawal
                    </Button>
                  </div>
                  <RecordedWithdrawals
                    transactions={recordedWithdrawalsFor("partner", partner.partnerId)}
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
                            action={<Amount value={sub.canTake} size="sm" />}
                          />
                          <div className="ml-1 mt-1.5">
                            <Button
                              variant="ghost"
                              onClick={() =>
                                openRecordWithdrawalDialog("sub_partner", sub.subPartnerId, sub.name)
                              }
                              icon={<Minus size={14} />}
                            >
                              Record Withdrawal
                            </Button>
                          </div>
                          <RecordedWithdrawals
                            transactions={recordedWithdrawalsFor("sub_partner", sub.subPartnerId)}
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

      <Dialog
        open={recordTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeRecordWithdrawalDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>Record Withdrawal{recordTarget ? ` — ${recordTarget.personName}` : ""}</DialogTitle>
          <DialogDescription>
            Saved with an audit record (AD-5). No cap against Can Take is enforced here -- any amount,
            including one exceeding Can Take, is accepted and recorded as-is.
          </DialogDescription>
          <form onSubmit={handleRecordWithdrawalSubmit} className="mt-4">
            <Field>
              <Label htmlFor="wtx-amount">Amount</Label>
              <Input
                id="wtx-amount"
                name="amount"
                inputMode="decimal"
                value={recordAmount}
                onChange={(event) => setRecordAmount(event.target.value)}
                required
                autoFocus
              />
              {/*
                Combines two separate Add Money precedents, not one "identical
                field" -- Add Money has no single Amount field carrying both
                halves of this hint. The format-hint half ("e.g. 1000000 for
                ₹10,00,000...") is New Requirement's Amount field's Helper
                text (add-money/page.tsx); the "0 is accepted" half is Record
                Payment's Amount field's Helper text, reworded here for
                withdrawals ("no minimum payment enforced" -> "no forced
                withdrawal").
              */}
              <Helper>
                e.g. 1000000 for ₹10,00,000 -- up to 2 decimal places are supported. 0 is accepted -- no
                forced withdrawal.
              </Helper>
            </Field>
            <Field>
              <Label htmlFor="wtx-date">Date</Label>
              <Input
                id="wtx-date"
                name="transactionDate"
                type="date"
                value={recordDate}
                onChange={(event) => setRecordDate(event.target.value)}
                required
              />
            </Field>
            <Field>
              <Label htmlFor="wtx-payment-mode">Payment Mode</Label>
              <select
                id="wtx-payment-mode"
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
              <Label htmlFor="wtx-reference">Reference Number</Label>
              <Input
                id="wtx-reference"
                name="referenceNumber"
                value={recordReferenceNumber}
                onChange={(event) => setRecordReferenceNumber(event.target.value)}
              />
              <Helper>Optional -- e.g. a cash withdrawal often has none.</Helper>
            </Field>
            <Field>
              <Label htmlFor="wtx-notes">Notes</Label>
              <Input
                id="wtx-notes"
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
                {recordSubmitting ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={closeRecordWithdrawalDialog}
                disabled={recordSubmitting}
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

/**
 * The recorded-withdrawals list shown under a Partner/Sub-partner's Can Take
 * row once withdrawals exist for them on this Project (Story 4.2) -- Date,
 * Amount, Payment Mode, mirroring `add-money/page.tsx`'s `RecordedPayments`
 * one ledger over. No edit/cancel affordance yet (Story 4.11's job, mirroring
 * `withdrawal_transactions`' own Story-3.3-before-3.7/3.8 shape). Renders
 * nothing when there's nothing to show (no fetch-state handling here --
 * `recordedWithdrawalsFor` already resolves "not loaded yet" to `[]`).
 */
function RecordedWithdrawals({ transactions }: { transactions: WithdrawalTransaction[] }) {
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
