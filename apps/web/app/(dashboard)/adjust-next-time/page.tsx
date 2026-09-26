"use client";

import { useEffect, useState, type FormEvent } from "react";
import { RotateCcw, Save, Scale, X } from "lucide-react";
import {
  AdjustPersonCard,
  Amount,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  Field,
  Helper,
  Input,
  Label,
  PageHeader,
  StatusChip,
  formatAmount,
  toast,
  type StatusChipVariant,
} from "@niveshbook/ui";
import {
  getAdjustNextTime,
  recordAdjustmentNetting,
  type AdjustNextTimeInvestmentEntry,
  type AdjustNextTimeWithdrawalEntry,
} from "@/lib/adjust-next-time";

type AdjustNextTimeState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "loaded";
      investmentAdjustments: AdjustNextTimeInvestmentEntry[];
      withdrawalAdjustments: AdjustNextTimeWithdrawalEntry[];
      canNet: boolean;
    };

/** Reused VERBATIM from `add-money/page.tsx`'s `AdjustmentChip` (Story 3.4) -- never reworded (this story's Boundaries). */
const INVESTMENT_ADJUSTMENT_LABEL: Record<AdjustNextTimeInvestmentEntry["adjustmentType"], string> = {
  extra_paid: "Extra Paid",
  pending: "Pending",
  none: "No Adjustment",
};
const INVESTMENT_ADJUSTMENT_VARIANT: Record<AdjustNextTimeInvestmentEntry["adjustmentType"], StatusChipVariant> = {
  extra_paid: "success",
  pending: "danger",
  none: "neutral",
};

/** Reused VERBATIM from `withdraw-money/page.tsx`'s `AdjustmentChip` (Story 4.3) -- never reworded (this story's Boundaries). */
const WITHDRAWAL_ADJUSTMENT_LABEL: Record<AdjustNextTimeWithdrawalEntry["adjustmentType"], string> = {
  keep_for_later: "Keep for Later",
  extra_taken: "Extra Taken",
  none: "No Adjustment",
};
const WITHDRAWAL_ADJUSTMENT_VARIANT: Record<AdjustNextTimeWithdrawalEntry["adjustmentType"], StatusChipVariant> = {
  extra_taken: "danger",
  keep_for_later: "violet",
  none: "neutral",
};

/**
 * The AC's literal phrasing, verbatim (epics.md Story 5.3): "Next time
 * reduce by ₹2,00,000" for Extra Paid, "Next time add ₹2,00,000" for
 * Pending -- no formula shown. `null` for "none" (nothing to say). The
 * Withdrawal section deliberately does NOT get an equivalent invented
 * sentence (this story's Implementation Notes) -- its own AC (row 2 of the
 * frozen I/O matrix) only requires visibility, separate from Investment; the
 * `AdjustmentChip` below already carries the label + amount.
 */
function investmentResolutionText(entry: AdjustNextTimeInvestmentEntry): string | null {
  if (entry.adjustmentType === "extra_paid") {
    return `Next time reduce by ${formatAmount(entry.adjustmentAmount)}`;
  }
  if (entry.adjustmentType === "pending") {
    return `Next time add ${formatAmount(entry.adjustmentAmount)}`;
  }
  return null;
}

function InvestmentAdjustmentChip({ entry }: { entry: AdjustNextTimeInvestmentEntry }) {
  return (
    <StatusChip variant={INVESTMENT_ADJUSTMENT_VARIANT[entry.adjustmentType]}>
      {INVESTMENT_ADJUSTMENT_LABEL[entry.adjustmentType]}
      {entry.adjustmentType !== "none" ? (
        <>
          {" "}
          <Amount value={entry.adjustmentAmount} size="sm" />
        </>
      ) : null}
    </StatusChip>
  );
}

function WithdrawalAdjustmentChip({ entry }: { entry: AdjustNextTimeWithdrawalEntry }) {
  return (
    <StatusChip variant={WITHDRAWAL_ADJUSTMENT_VARIANT[entry.adjustmentType]}>
      {WITHDRAWAL_ADJUSTMENT_LABEL[entry.adjustmentType]}
      {entry.adjustmentType !== "none" ? (
        <>
          {" "}
          <Amount value={entry.adjustmentAmount} size="sm" />
        </>
      ) : null}
    </StatusChip>
  );
}

/**
 * Adjust Next Time page (Story 5.3, FR33/FR34) -- reads `GET
 * /api/adjust-next-time`, which is already correctly scoped for all three
 * roles (`authorizeScope`'s grant, `resolveMoneyHistoryScope`'s per-row
 * scoping, reused unchanged from Story 5.1). This page itself is only
 * reachable today via the Owner/Admin-gated dashboard shell
 * (`requireOwnerAdminSession()`) -- mirrors Money History's identical Story
 * 5.1 precedent; a Partner/Sub-partner's own reachable path is a later
 * story's job, not this one's.
 *
 * Two entirely independent sections (AC3, this story's Boundaries: "no
 * combined/summed figure anywhere on the page") -- Investment and Withdrawal
 * Adjustment are never merged, summed, or displayed as one net figure. A
 * person with independent Investment Adjustment rows at DIFFERENT Projects
 * gets multiple separate Investment section cards (never merged) -- each
 * `AdjustNextTimeInvestmentEntry` already IS one Project's own single
 * current row (`investment_adjustments` has exactly ONE current row per
 * `(partyType, shareId, projectId)`, spec-5-3's corrected Decisions #2 --
 * same-Project multiplicity is not a reachable state; cross-Project is).
 *
 * The "Net Adjustment" action (Owner/Admin-only, `canNet` from the route,
 * resolved server-side from the actor's own live role) opens a dialog
 * showing that same person's Withdrawal Adjustment for context, then calls
 * `recordAdjustmentNetting()` -- a pure audit record (AD-4): saving it never
 * changes either ledger's own numbers, only refreshes this page's own two
 * lists (still freshly computed from Should Pay/Can Take, unchanged) plus
 * the new netting record now existing. The dialog's own title shows both
 * `personName` AND `projectName` (review fix, 2026-09-25) -- since a
 * person's two different-Project rows can legitimately show the identical
 * adjustment type/amount (e.g. "Pending ₹50,000" at both), `personName`
 * alone can't disambiguate which Project is about to be netted; the
 * submitted payload itself was always correct either way (derived from the
 * clicked row's own captured `nettingTarget`, never re-derived), so this was
 * a visual-confirmation gap, not a data-integrity bug.
 */
export default function AdjustNextTimePage() {
  const [state, setState] = useState<AdjustNextTimeState>({ status: "loading" });
  const [nettingTarget, setNettingTarget] = useState<AdjustNextTimeInvestmentEntry | null>(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Minted once per dialog-open, mirroring `available-balance/page.tsx`'s
  // `idempotencyKey`'s identical caller-owns-the-key-lifecycle contract.
  const [idempotencyKey, setIdempotencyKey] = useState("");

  async function refresh() {
    setState({ status: "loading" });
    try {
      const result = await getAdjustNextTime();
      setState({
        status: "loaded",
        investmentAdjustments: result.investmentAdjustments,
        withdrawalAdjustments: result.withdrawalAdjustments,
        canNet: result.canNet,
      });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }

  useEffect(() => {
    // `refresh` is a component-scoped function whose body sets state -- the
    // `react-hooks/set-state-in-effect` lint rule flags a direct call to one
    // as if it happened synchronously in the effect; nesting the call inside
    // an async IIFE satisfies the rule, mirroring `money-history/page.tsx`'s
    // identical precedent.
    void (async () => {
      await refresh();
    })();
  }, []);

  /** That same person's Withdrawal Adjustment row, for the netting dialog's own context display -- `null` if they have none yet. */
  function findWithdrawalAdjustmentFor(
    entry: AdjustNextTimeInvestmentEntry,
  ): AdjustNextTimeWithdrawalEntry | null {
    if (state.status !== "loaded") return null;
    return (
      state.withdrawalAdjustments.find(
        (row) =>
          row.partyType === entry.partyType &&
          row.shareId === entry.shareId &&
          row.projectId === entry.projectId,
      ) ?? null
    );
  }

  function openNettingDialog(entry: AdjustNextTimeInvestmentEntry) {
    setNettingTarget(entry);
    setAmount("");
    setNotes("");
    setFormError(null);
    setIdempotencyKey(crypto.randomUUID());
  }

  function closeNettingDialog() {
    setNettingTarget(null);
    setFormError(null);
  }

  const canSubmit = amount.trim().length > 0 && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nettingTarget || !canSubmit) return;

    setFormError(null);
    setSubmitting(true);
    try {
      await recordAdjustmentNetting(
        {
          projectId: nettingTarget.projectId,
          partyType: nettingTarget.partyType,
          shareId: nettingTarget.shareId,
          investmentRequirementId: nettingTarget.requirementId,
          amount,
          notes: notes.trim().length > 0 ? notes.trim() : null,
        },
        idempotencyKey,
      );
      toast.success(`${formatAmount(amount)} netted for ${nettingTarget.personName}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    closeNettingDialog();
    await refresh();
  }

  const contextWithdrawalAdjustment = nettingTarget ? findWithdrawalAdjustmentFor(nettingTarget) : null;

  return (
    <div>
      <PageHeader
        title="Adjust Next Time"
        description="Amounts still pending or extra from past rounds -- shown separately for Investments and Withdrawals, never combined automatically."
      />

      {state.status === "loading" ? (
        <Card>
          <p className="text-[13.4px] text-ink-soft">Loading Adjust Next Time…</p>
        </Card>
      ) : state.status === "error" ? (
        <Card>
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-5 max-[860px]:grid-cols-1">
          <Card>
            <h2 className="mb-3.5 text-[15px] font-bold">Investment Adjustments</h2>
            {state.investmentAdjustments.length === 0 ? (
              <EmptyState
                icon={<RotateCcw size={22} />}
                title="No Investment Adjustments yet"
                description="Carried-forward Investment Adjustments will show up here once funding requirements are recorded."
              />
            ) : (
              state.investmentAdjustments.map((entry) => (
                <AdjustPersonCard
                  key={entry.id}
                  // Founder feedback 2026-09-26: sub-partner cards sit one
                  // hierarchy level (24px) right of partner cards -- wired
                  // from the row's own `partyType`, never inferred from the
                  // display name. `role` (spec-partner-hierarchy-cards) adds
                  // the role tint on top: partner = teal, sub-partner =
                  // violet, so the role reads from card styling alone even
                  // in this flat list where no parent card is present.
                  isSub={entry.partyType === "sub_partner"}
                  role={entry.partyType}
                  name={`${entry.personName} — ${entry.projectName}`}
                  lines={[
                    { label: "Should Pay", value: <Amount value={entry.shouldPay} size="sm" /> },
                    { label: "Actual Paid", value: <Amount value={entry.actualPaid} size="sm" /> },
                  ]}
                  resolution={
                    <>
                      <InvestmentAdjustmentChip entry={entry} />
                      <span className="flex items-center gap-2.5">
                        {investmentResolutionText(entry) ? (
                          <span className="text-ink-soft">{investmentResolutionText(entry)}</span>
                        ) : null}
                        {state.canNet ? (
                          <Button
                            variant="ghost"
                            tone="accent"
                            onClick={() => openNettingDialog(entry)}
                            icon={<Scale size={12} />}
                          >
                            Net Adjustment
                          </Button>
                        ) : null}
                      </span>
                    </>
                  }
                />
              ))
            )}
          </Card>

          <Card>
            <h2 className="mb-3.5 text-[15px] font-bold">Withdrawal Adjustments</h2>
            {state.withdrawalAdjustments.length === 0 ? (
              <EmptyState
                icon={<RotateCcw size={22} />}
                title="No Withdrawal Adjustments yet"
                description="Carried-forward Withdrawal Adjustments will show up here once withdrawals are recorded."
              />
            ) : (
              state.withdrawalAdjustments.map((entry) => (
                <AdjustPersonCard
                  key={entry.id}
                  isSub={entry.partyType === "sub_partner"}
                  role={entry.partyType}
                  name={`${entry.personName} — ${entry.projectName}`}
                  lines={[
                    { label: "Can Take", value: <Amount value={entry.canTake} size="sm" /> },
                    { label: "Taken", value: <Amount value={entry.taken} size="sm" /> },
                  ]}
                  resolution={<WithdrawalAdjustmentChip entry={entry} />}
                />
              ))
            )}
          </Card>
        </div>
      )}

      <Dialog
        open={nettingTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeNettingDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>
            Net Adjustment
            {nettingTarget ? ` — ${nettingTarget.personName} · ${nettingTarget.projectName}` : ""}
          </DialogTitle>
          <DialogDescription>
            {nettingTarget ? (
              <>
                Investment Adjustment: <InvestmentAdjustmentChip entry={nettingTarget} />. Withdrawal
                Adjustment (for context):{" "}
                {contextWithdrawalAdjustment ? (
                  <WithdrawalAdjustmentChip entry={contextWithdrawalAdjustment} />
                ) : (
                  "none recorded yet"
                )}
                . Recorded on its own -- this never changes the Investment or Withdrawal numbers
                themselves.
              </>
            ) : null}
          </DialogDescription>

          <form onSubmit={handleSubmit} className="mt-4">
            <Field>
              <Label htmlFor="an-amount">Amount</Label>
              <Input
                id="an-amount"
                name="amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
                autoFocus
              />
              <Helper>The amount agreed to be netted between these two adjustments.</Helper>
            </Field>

            <Field>
              <Label htmlFor="an-notes">Notes</Label>
              <Input id="an-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
              <Helper>Optional.</Helper>
            </Field>

            {formError ? (
              <p role="alert" className="mb-4 text-[13.4px] text-danger">
                {formError}
              </p>
            ) : null}

            <div className="flex gap-2.5">
              <Button type="submit" disabled={!canSubmit} icon={<Save size={14} />}>
                {submitting ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={closeNettingDialog}
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
