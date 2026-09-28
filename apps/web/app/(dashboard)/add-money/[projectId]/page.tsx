"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Wallet, Save, X, ChevronDown, ChevronUp } from "lucide-react";
import type { InvestmentRequirement, PaymentMode } from "@niveshbook/types";
import {
  Amount,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  EmptyState,
  Field,
  Helper,
  Input,
  Label,
  PageHeader,
  StatCard,
  toast,
} from "@niveshbook/ui";
import { getOwnershipStructure } from "@/lib/ownership-structure";
import { listInvestmentRequirements } from "@/lib/investment-requirements";
import { getMyInvestmentStatus, type MyInvestmentStatusResponse } from "@/lib/my-investment-status";
import { recordInvestmentTransaction } from "@/lib/investment-transactions";

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
  | { status: "loaded"; projectName: string; requirements: InvestmentRequirement[] };

type StatusState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; response: MyInvestmentStatusResponse };

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Partner/Sub-partner self-service Add Money (2026-09-29) -- a new, small,
 * standalone page deliberately OUTSIDE `/projects/**` (mirrors
 * `structure/[projectId]/page.tsx`'s established shape: `"use client"`,
 * `partnerId`/`subPartnerId` read from the query string, no page-level
 * `authorize()` call -- every real read/write below goes through a route
 * that already calls `authorize()`/`authorizeScope()` itself (AD-1), so a
 * tampered/missing query param can only ever 403, never widen access).
 *
 * Deliberately scoped down from the Owner/Admin Add Money page (1715
 * lines): no bulk table, no "New Funding Requirement" creation, no Edit/
 * Cancel of past transactions -- lists this Project's funding requirements
 * (self-access via the new `investment_requirements:list` scope rule),
 * expanding one shows the caller's own Should Pay/Actual Paid/Recommended
 * (Story 3.6's dormant `my-investment-status` endpoint, its first caller),
 * and a single "Add Investment" dialog records a payment against the
 * caller's own share (`investment_transactions:create`, already
 * self-access-capable since Story 3.3).
 */
export default function AddMoneyPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const searchParams = useSearchParams();

  const partnerId = searchParams.get("partnerId");
  const subPartnerId = searchParams.get("subPartnerId");
  const partyType: PartyType | null = partnerId ? "partner" : subPartnerId ? "sub_partner" : null;
  const shareId = partnerId ?? subPartnerId ?? null;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [expandedRequirementId, setExpandedRequirementId] = useState<string | null>(null);
  const [statusByRequirement, setStatusByRequirement] = useState<Record<string, StatusState>>({});

  const [dialogRequirement, setDialogRequirement] = useState<InvestmentRequirement | null>(null);
  const [amount, setAmount] = useState("");
  const [transactionDate, setTransactionDate] = useState(todayDate());
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
      setState({ status: "loading" });
      try {
        const [structureResult, requirementsResult] = await Promise.all([
          getOwnershipStructure(projectId, {
            partnerId: partnerId ?? undefined,
            subPartnerId: subPartnerId ?? undefined,
          }),
          listInvestmentRequirements(projectId),
        ]);
        if (!cancelled) {
          setState({
            status: "loaded",
            projectName: structureResult.projectName,
            requirements: [...requirementsResult.requirements].sort((a, b) =>
              b.requirementDate.localeCompare(a.requirementDate),
            ),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Something went wrong.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- partyType/shareId are derived from partnerId/subPartnerId, listed separately would be redundant
  }, [projectId, partnerId, subPartnerId]);

  async function loadStatus(requirement: InvestmentRequirement) {
    if (!partyType || !shareId) return;
    setStatusByRequirement((prev) => ({ ...prev, [requirement.id]: { status: "loading" } }));
    try {
      const response = await getMyInvestmentStatus(projectId, requirement.id, partyType, shareId);
      setStatusByRequirement((prev) => ({ ...prev, [requirement.id]: { status: "loaded", response } }));
    } catch (error) {
      setStatusByRequirement((prev) => ({
        ...prev,
        [requirement.id]: {
          status: "error",
          message: error instanceof Error ? error.message : "Something went wrong.",
        },
      }));
    }
  }

  function handleToggleExpand(requirement: InvestmentRequirement) {
    if (expandedRequirementId === requirement.id) {
      setExpandedRequirementId(null);
      return;
    }
    setExpandedRequirementId(requirement.id);
    const existing = statusByRequirement[requirement.id];
    if (!existing || existing.status === "error") {
      void loadStatus(requirement);
    }
  }

  function openDialog(requirement: InvestmentRequirement) {
    setDialogRequirement(requirement);
    setAmount("");
    setTransactionDate(todayDate());
    setPaymentMode("cash");
    setReferenceNumber("");
    setNotes("");
    setFormError(null);
    setIdempotencyKey(crypto.randomUUID());
  }

  function closeDialog() {
    setDialogRequirement(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!dialogRequirement || !partyType || !shareId) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await recordInvestmentTransaction(
        projectId,
        dialogRequirement.id,
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
      toast.success("Investment recorded.");
      const requirement = dialogRequirement;
      closeDialog();
      await loadStatus(requirement);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (state.status === "loading") {
    return (
      <div>
        <PageHeader title="Add Money" />
        <Card>
          <p className="text-[13.4px] text-ink-soft">Loading…</p>
        </Card>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        <PageHeader title="Add Money" />
        <Card>
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        </Card>
      </div>
    );
  }

  const { projectName, requirements } = state;

  return (
    <div>
      <PageHeader title="Add Money" description={`${projectName} -- your own investment payments.`} />

      {requirements.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet size={22} />}
            title="No funding requirements yet"
            description="Once this Project has a funding requirement, it will show up here for you to pay against."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {requirements.map((requirement) => {
            const isExpanded = expandedRequirementId === requirement.id;
            const statusState = statusByRequirement[requirement.id];
            return (
              <Card key={requirement.id}>
                <button
                  type="button"
                  onClick={() => handleToggleExpand(requirement)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <div className="text-[13.8px] font-bold text-ink">Requirement of {""}
                      <Amount value={requirement.amount} size="sm" />
                    </div>
                    <div className="text-[12.6px] text-ink-soft">{requirement.requirementDate}</div>
                  </div>
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {isExpanded ? (
                  <div className="mt-4 border-t border-border pt-4">
                    {!statusState || statusState.status === "loading" ? (
                      <p className="text-[13.4px] text-ink-soft">Loading your status…</p>
                    ) : statusState.status === "error" ? (
                      <p role="alert" className="text-[13.4px] text-danger">
                        {statusState.message}
                      </p>
                    ) : (
                      <>
                        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                          <StatCard label="Should Pay" value={statusState.response.status.shouldPay} tone="danger" />
                          <StatCard label="Actual Paid" value={statusState.response.status.actualPaid} tone="success" />
                          {statusState.response.status.recommendedAmount !== undefined ? (
                            <StatCard
                              label="Recommended"
                              value={statusState.response.status.recommendedAmount}
                              tone="violet"
                            />
                          ) : null}
                        </div>
                        <Button icon={<Wallet size={14} />} onClick={() => openDialog(requirement)}>
                          Add Investment
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={dialogRequirement !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>Add Investment</DialogTitle>
          <DialogDescription>Record a payment you made against this funding requirement.</DialogDescription>
          <form onSubmit={handleSubmit} className="mt-4">
            <Field>
              <Label htmlFor="my-tx-amount">Amount</Label>
              <Input
                id="my-tx-amount"
                name="amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
                autoFocus
              />
              <Helper>0 is accepted -- no minimum payment enforced.</Helper>
            </Field>
            <Field>
              <Label htmlFor="my-tx-date">Date</Label>
              <Input
                id="my-tx-date"
                name="transactionDate"
                type="date"
                value={transactionDate}
                onChange={(event) => setTransactionDate(event.target.value)}
                required
              />
            </Field>
            <Field>
              <Label htmlFor="my-tx-payment-mode">Payment Mode</Label>
              <select
                id="my-tx-payment-mode"
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
              <Label htmlFor="my-tx-reference">Reference Number</Label>
              <Input
                id="my-tx-reference"
                name="referenceNumber"
                value={referenceNumber}
                onChange={(event) => setReferenceNumber(event.target.value)}
              />
              <Helper>Optional -- e.g. a cash payment often has none.</Helper>
            </Field>
            <Field>
              <Label htmlFor="my-tx-notes">Notes</Label>
              <Input id="my-tx-notes" name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            {formError ? (
              <p role="alert" className="mb-4 text-[13.4px] text-danger">
                {formError}
              </p>
            ) : null}
            <div className="flex gap-2.5">
              <Button type="submit" disabled={submitting} icon={<Save size={14} />}>
                {submitting ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" onClick={closeDialog} disabled={submitting} icon={<X size={14} />}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
