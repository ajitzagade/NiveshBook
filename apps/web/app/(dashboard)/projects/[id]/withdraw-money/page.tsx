"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, BanknoteArrowDown, Minus, Save, ShieldCheck, X } from "lucide-react";
import type { PartnerCanTake, PartnerWithdrawalAdjustment } from "@niveshbook/core";
import type { Money, PaymentMode, WithdrawalTransaction } from "@niveshbook/types";
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
  toast,
  formatAmount,
  type StatusChipVariant,
} from "@niveshbook/ui";
import { getCanTake } from "@/lib/can-take";
import { getWithdrawalAdjustments } from "@/lib/withdrawal-adjustments";
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

/**
 * Story 4.3: the Withdrawal Adjustment status per Partner/Sub-partner,
 * mirroring `add-money/page.tsx`'s `AdjustmentsState` one ledger over.
 * Project-scoped (unlike Investment Adjustment's per-requirement fetch), so
 * fetched once on page load alongside Can Take/recorded withdrawals, not
 * per-expanded-panel.
 */
type AdjustmentsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; partners: PartnerWithdrawalAdjustment[] };

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

/** Digit-by-digit accumulation, never `parseFloat`/`Number()` on a full numeric string -- mirrors `packages/core/src/decimal-math.ts`'s identical `digitsToInt` helper. Exported (alongside its sibling helpers below) only so `page.test.tsx` can unit-test this hand-rolled arithmetic directly -- Next.js's App Router only ever resolves this file's default export as the route; extra named exports are otherwise inert. */
export function digitsToInt(digits: string): number {
  let value = 0;
  for (const char of digits) {
    value = value * 10 + (char.charCodeAt(0) - 48);
  }
  return value;
}

/**
 * Scales a plain decimal string (up to 2 fractional digits) to an integer
 * (`"250000" -> 25000000`), mirroring `decimal-math.ts`'s `parseMoneyScaled`
 * shape -- never `parseFloat`. Returns `0` for anything that doesn't match a
 * bare non-negative decimal (a client-typed amount mid-edit, e.g. `""` or
 * `"12."`) rather than throwing -- this is a client-side UX nicety only (see
 * `exceedsCanTake`'s doc comment below), never the authoritative validation
 * (the server's own `toMoney` is), so a malformed value just can't
 * spuriously register as "exceeding" anything.
 */
export function scaleMoneyForCompare(raw: string): number {
  const trimmed = raw.trim();
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return 0;
  const [, wholePart, fractionPart = ""] = match;
  return digitsToInt(wholePart as string) * 100 + digitsToInt((fractionPart as string).padEnd(2, "0"));
}

/**
 * Story 4.5 (FR25): decimal-safe "does `amount` exceed `canTake`" check
 * driving this page's client-side Record Withdrawal submit interception --
 * scaled-integer arithmetic mirroring `packages/core/src/decimal-math.ts`'s
 * `compareMoney` (AD-2: never a raw `>` on the strings themselves), but its
 * own small local copy, not a runtime import of `compareMoney` from
 * `@niveshbook/core`. This "use client" page cannot import any *runtime*
 * value from that package's barrel -- see `recommendedWithdrawalFor`'s doc
 * comment further below for the identical `next build` "Module not found:
 * Can't resolve 'fs'" failure this would otherwise cause, tracing back to
 * `auth.ts`'s `argon2` dependency. This check is a client-side UX nicety
 * only, deciding whether to show the Authorize Extra Withdrawal confirmation
 * dialog before submitting -- the route's own `assertExtraWithdrawalAuthorized`
 * (using the real `compareMoney`, server-side) is the authoritative gate
 * either way, never trusted from here.
 */
export function exceedsCanTake(amount: string, canTake: Money): boolean {
  return scaleMoneyForCompare(amount) > scaleMoneyForCompare(canTake);
}

/**
 * `amount - canTake`, clamped at `0`, for the Authorize Extra Withdrawal
 * dialog's "exceeds by ₹X" display line only -- never submitted/stored.
 * Mirrors `recommendedWithdrawalFor`'s existing `"0" as Money` cast
 * precedent in this same file (a locally-computed literal, not untrusted
 * input, so `toMoney`'s validation is unneeded here).
 */
export function excessOverCanTake(amount: string, canTake: Money): Money {
  const diff = scaleMoneyForCompare(amount) - scaleMoneyForCompare(canTake);
  const safeDiff = diff > 0 ? diff : 0;
  const whole = Math.trunc(safeDiff / 100);
  const fraction = safeDiff % 100;
  return (fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`) as Money;
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
  const [adjustmentsState, setAdjustmentsState] = useState<AdjustmentsState>({ status: "loading" });

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

  // Story 4.5 (FR25): the "Authorize Extra Withdrawal?" confirmation dialog,
  // opened *on top of* the still-open Record Withdrawal dialog when its
  // normal submit is intercepted (`handleRecordWithdrawalSubmit` below) --
  // mirrors `add-money/page.tsx`'s Story 3.8 Cancel Payment dialog shape
  // (separate confirmation dialog, no editable fields of its own), reusing
  // this same page's `recordAmount`/`recordTarget`/etc. state rather than
  // duplicating a second copy of the form's fields.
  const [extraWithdrawalOpen, setExtraWithdrawalOpen] = useState(false);

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

  /**
   * Fetches the Withdrawal Adjustment status per Partner/Sub-partner (Story
   * 4.3) -- Project-scoped, so fetched once for the whole page rather than
   * per-expanded-panel like Add Money's per-requirement `refreshAdjustments`.
   * A failed fetch here just means no chips show (secondary enrichment of
   * the Can Take panel, not its primary content) -- mirrors
   * `add-money/page.tsx`'s identical swallow-to-"error"-state convention.
   * Called directly from both the mount effect and
   * `handleRecordWithdrawalSubmit`'s post-save refresh -- a single
   * implementation, never duplicated inline, mirroring `add-money/page.tsx`'s
   * `void refreshAdjustments(requirementId)` mount-effect precedent.
   *
   * Wrapped in `useCallback` (keyed on `projectId`) so its identity stays
   * stable across renders -- lets the mount effect below list it as a real
   * dependency (satisfying `react-hooks/exhaustive-deps`) without a stable
   * reference, `projectId` changing would be the only thing that should
   * re-trigger the effect, but an unmemoized function recreated every render
   * would falsely trigger it on every render instead.
   */
  const refreshAdjustments = useCallback(async () => {
    try {
      const result = await getWithdrawalAdjustments(projectId);
      setAdjustmentsState({ status: "loaded", partners: result.partners });
    } catch (error) {
      setAdjustmentsState({
        status: "error",
        message: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }, [projectId]);

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

    // Calls the single `refreshAdjustments` implementation (never duplicates
    // its fetch/setState/error-handling body inline, unlike this effect's
    // other two fetches above -- those have no standalone function to call
    // since nothing else needs to re-trigger them). Wrapped in an async IIFE,
    // not a bare `void refreshAdjustments()` -- the `react-hooks/set-state-in-effect`
    // lint rule flags a direct call to a component-scoped function whose body
    // sets state as if it happened synchronously in the effect; nesting the
    // call inside a callback (mirroring the `.then()`-callback shape above)
    // satisfies the rule the same way `getCanTake(...).then((result) => ...)`
    // already does.
    void (async () => {
      await refreshAdjustments();
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshAdjustments]);

  /** Finds a Partner's Withdrawal Adjustment status (Story 4.3) in an already-loaded `AdjustmentsState` -- `null` if not loaded yet, errored, or (defensively) not found. */
  function findPartnerAdjustment(partnerId: string): AdjustmentChipInfo | null {
    if (adjustmentsState.status !== "loaded") return null;
    return adjustmentsState.partners.find((partner) => partner.partnerId === partnerId) ?? null;
  }

  /** Finds a Sub-partner's Withdrawal Adjustment status (Story 4.3) nested under its parent Partner -- mirrors `findPartnerAdjustment` one level down. */
  function findSubPartnerAdjustment(partnerId: string, subPartnerId: string): AdjustmentChipInfo | null {
    if (adjustmentsState.status !== "loaded") return null;
    const partner = adjustmentsState.partners.find((candidate) => candidate.partnerId === partnerId);
    return partner?.subPartners.find((sub) => sub.subPartnerId === subPartnerId) ?? null;
  }

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

  /**
   * Finds a Partner/Sub-partner's *live* Can Take (Story 4.1) in this page's
   * already-loaded `state` -- `null` if not loaded yet, errored, or
   * (defensively) not found. Drives Story 4.5's client-side "does the
   * entered amount exceed Can Take" check (`handleRecordWithdrawalSubmit`
   * below); the target's Can Take shown in the panel (`partner.canTake`/
   * `sub.canTake`) is the exact same figure the route independently
   * recomputes server-side (`computeCanTake`) before writing.
   */
  function canTakeForTarget(partyType: "partner" | "sub_partner", shareId: string): Money | null {
    if (state.status !== "loaded") return null;
    if (partyType === "partner") {
      return state.partners.find((partner) => partner.partnerId === shareId)?.canTake ?? null;
    }
    for (const partner of state.partners) {
      const match = partner.subPartners.find((sub) => sub.subPartnerId === shareId);
      if (match) return match.canTake;
    }
    return null;
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
    setExtraWithdrawalOpen(false);
    // A fresh key for this new logical submission -- see the state's own doc comment.
    setRecordIdempotencyKey(crypto.randomUUID());
  }

  function closeRecordWithdrawalDialog() {
    setRecordTarget(null);
    setExtraWithdrawalOpen(false);
  }

  /** Closes just the Authorize Extra Withdrawal dialog (Story 4.5) -- the Record Withdrawal dialog underneath stays open, values untouched, so the user can adjust the amount and try again. No submission occurs. */
  function closeExtraWithdrawalDialog() {
    setExtraWithdrawalOpen(false);
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
   * failed submission (the user clicking Save again, or re-confirming
   * Authorize Extra Withdrawal, with the dialog still open) reuses that same
   * key, so a real double-submit is deduped server-side rather than creating
   * two rows.
   *
   * `authorized` is passed through unchanged as `extraWithdrawalAuthorized`
   * (Story 4.5, FR25) -- `false` for a normal submit
   * (`handleRecordWithdrawalSubmit` below), `true` only when the user has
   * confirmed the Authorize Extra Withdrawal dialog
   * (`handleAuthorizeExtraWithdrawalConfirm`). On failure, deliberately
   * leaves both dialogs' open/closed state untouched -- the error renders in
   * whichever one is currently on screen, mirroring `add-money/page.tsx`'s
   * Cancel Payment dialog's identical stay-open-on-error convention.
   */
  async function submitWithdrawal(authorized: boolean) {
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
          extraWithdrawalAuthorized: authorized,
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
    setExtraWithdrawalOpen(false);
    closeRecordWithdrawalDialog();
    // Best-effort, mirroring `add-money/page.tsx`'s identical convention --
    // the withdrawal is already saved server-side either way. Refreshing
    // adjustments here is what keeps Story 4.3's Withdrawal Adjustment chip
    // in sync with the newly-recorded Taken amount -- no separate recompute
    // call needed, since viewing the endpoint is what upserts the ledger.
    await Promise.all([
      refreshWithdrawals().catch(() => {}),
      refreshCanTake().catch(() => {}),
      refreshAdjustments().catch(() => {}),
    ]);
  }

  /**
   * The Record Withdrawal form's own submit (Story 4.2, extended by Story
   * 4.5/FR25). Compares `recordAmount` against the target's *live* Can Take
   * (`canTakeForTarget`, sourced from this page's already-loaded `state` --
   * the exact same figure the server independently recomputes) via
   * `exceedsCanTake`. Within Can Take (or Can Take not yet resolvable):
   * submits immediately, exactly as before this story
   * (`extraWithdrawalAuthorized: false`). Exceeds Can Take: intercepts the
   * submit -- no API call here -- and opens the Authorize Extra Withdrawal
   * confirmation dialog instead, deferring the actual save to
   * `handleAuthorizeExtraWithdrawalConfirm`.
   */
  async function handleRecordWithdrawalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recordTarget) return;

    const targetCanTake = canTakeForTarget(recordTarget.partyType, recordTarget.shareId);
    if (targetCanTake !== null && exceedsCanTake(recordAmount, targetCanTake)) {
      setRecordFormError(null);
      setExtraWithdrawalOpen(true);
      return;
    }

    await submitWithdrawal(false);
  }

  /** Confirms the Authorize Extra Withdrawal dialog (Story 4.5, FR25) -- resubmits with `extraWithdrawalAuthorized: true`. No form fields of its own to validate (mirrors Cancel Payment's identical "no editable fields" shape). */
  async function handleAuthorizeExtraWithdrawalConfirm() {
    await submitWithdrawal(true);
  }

  // Derived once per render for the Authorize Extra Withdrawal dialog's copy
  // below (Story 4.5) -- `null` whenever `recordTarget`/Can Take aren't both
  // resolvable yet, which the dialog's own render guards against.
  const extraWithdrawalCanTake = recordTarget
    ? canTakeForTarget(recordTarget.partyType, recordTarget.shareId)
    : null;

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
              {state.partners.map((partner) => {
                // Computed once per row and passed to both `<AdjustmentChip>`
                // and `<RecommendedWithdrawal>` below -- calling
                // `findPartnerAdjustment` twice would re-scan
                // `adjustmentsState.partners` (an O(n) `.find`) a second time
                // for the same result.
                const partnerAdjustment = findPartnerAdjustment(partner.partnerId);
                return (
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
                  <div className="ml-1 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <AdjustmentChip adjustment={partnerAdjustment} />
                    <RecommendedWithdrawal adjustment={partnerAdjustment} />
                  </div>

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
                      {partner.subPartners.map((sub) => {
                        // Same once-per-row rationale as `partnerAdjustment`
                        // above, one level down.
                        const subAdjustment = findSubPartnerAdjustment(partner.partnerId, sub.subPartnerId);
                        return (
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
                          <div className="ml-1 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <AdjustmentChip adjustment={subAdjustment} />
                            <RecommendedWithdrawal adjustment={subAdjustment} />
                          </div>
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
                        );
                      })}
                    </ShareList>
                  ) : null}
                </div>
                );
              })}
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
            Saved with an audit record (AD-5). An amount within Can Take saves immediately; an amount
            that exceeds Can Take requires a separate Owner/Admin Extra Withdrawal authorization step
            (FR25).
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

      <Dialog
        open={extraWithdrawalOpen}
        onOpenChange={(open) => {
          if (!open) closeExtraWithdrawalDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>Authorize Extra Withdrawal?</DialogTitle>
          <DialogDescription>
            {recordTarget && extraWithdrawalCanTake !== null ? (
              <>
                <Amount value={recordAmount as Money} size="sm" /> exceeds {recordTarget.personName}
                &apos;s Can Take of <Amount value={extraWithdrawalCanTake} size="sm" /> by{" "}
                <Amount value={excessOverCanTake(recordAmount, extraWithdrawalCanTake)} size="sm" />.
                Only an Owner/Admin with Extra Withdrawal approval authority (Story 1.7) can authorize
                this excess as Extra Taken (FR25). Confirming records the full amount with this
                authorization; going back returns to the amount field with nothing saved.
              </>
            ) : null}
          </DialogDescription>

          {recordFormError ? (
            <p role="alert" className="mt-4 text-[13.4px] text-danger">
              {recordFormError}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2.5">
            <Button
              type="button"
              onClick={handleAuthorizeExtraWithdrawalConfirm}
              disabled={recordSubmitting}
              icon={<ShieldCheck size={14} />}
            >
              {recordSubmitting ? "Saving…" : "Confirm Authorization"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={closeExtraWithdrawalDialog}
              disabled={recordSubmitting}
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

type AdjustmentChipInfo = Pick<PartnerWithdrawalAdjustment, "adjustmentType" | "adjustmentAmount">;

const ADJUSTMENT_LABEL: Record<AdjustmentChipInfo["adjustmentType"], string> = {
  keep_for_later: "Keep for Later",
  extra_taken: "Extra Taken",
  none: "No Adjustment",
};

/**
 * spec-4-3's Decisions verbatim: `extra_taken` -> `danger` (mirrors
 * Investment Pending's "concerning, exceeds entitlement" treatment --
 * pre-Story-4.5, an over-take has no authorization trail yet); `keep_for_later`
 * -> `violet` (per epic-4-context.md's explicit UX convention: "`violet`
 * marks ... Keep for Later"); `none` -> `neutral` (mirrors Investment
 * Adjustment's identical "none" precedent).
 */
const ADJUSTMENT_VARIANT: Record<AdjustmentChipInfo["adjustmentType"], StatusChipVariant> = {
  extra_taken: "danger",
  keep_for_later: "violet",
  none: "neutral",
};

/**
 * The Withdrawal Adjustment status chip (Story 4.3) shown per Partner/
 * Sub-partner row once the page's `adjustments` fetch resolves -- reuses
 * `packages/ui`'s `StatusChip`, always paired with a text label (and, for
 * Keep for Later/Extra Taken, the amount) rather than color alone, mirroring
 * `add-money/page.tsx`'s `AdjustmentChip` one ledger over. Renders nothing
 * while the page's adjustments fetch hasn't loaded yet (or errored) -- a
 * secondary enrichment of the Can Take panel, never a blocking element.
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
 * Story 4.4 (FR24): the next cycle's Recommended Available Withdrawal,
 * derived entirely from Story 4.3's already-fetched Withdrawal Adjustment --
 * no new backend mechanism (confirmed with the user 2026-09-24; see this
 * story's Intent). Withdrawals have no discrete "new cycle" snapshot event
 * the way Story 3.5's Investment carry-forward does (Can Take/Taken are both
 * continuous, cumulative, Project-scoped totals), so `Can Take − Taken`
 * already algebraically equals `new Base Entitlement + Previous Keep For
 * Later` -- Story 4.3's `keep_for_later` adjustmentAmount already *is* the
 * recommendation, continuously, with no separate computation needed here.
 *
 * Returns `null` (renders nothing) both when the adjustment hasn't loaded yet
 * (never a misleading "₹0" -- mirrors `AdjustmentChip`'s identical
 * not-yet-loaded convention) AND for `"none"` (orchestrator-authorized
 * refinement, 2026-09-24: mirroring Add Money's "Recommended: ₹X" line,
 * which suppresses itself rather than restating a figure that adds no
 * information beyond the chip already shown -- "No Adjustment" already says
 * there's nothing to recommend). `"extra_taken"` still recommends `"0"` --
 * that zero *does* carry information distinct from "none"'s silence: nothing
 * further is recommended until back under entitlement (this epic's AC3).
 * `"extra_taken"` can't reuse the plain `Can Take − Taken` framing directly
 * either -- Taken exceeding Can Take there would make that subtraction
 * negative, which is never a valid Recommended Available Withdrawal.
 */
function recommendedWithdrawalFor(adjustment: AdjustmentChipInfo | null): Money | null {
  if (!adjustment || adjustment.adjustmentType === "none") return null;
  if (adjustment.adjustmentType === "keep_for_later") {
    return adjustment.adjustmentAmount;
  }
  // A validated `toMoney("0")` call would be nicer than this cast, but
  // `@niveshbook/core` has no subpath export -- any *runtime* (non-type-only)
  // import from it pulls in the whole barrel via `index.ts`, including
  // `auth.ts`'s `argon2` dependency (a native Node addon). That breaks the
  // client bundle for this "use client" page (confirmed: `next build` fails
  // with "Module not found: Can't resolve 'fs'" tracing straight back to
  // this import). `"0"` is a static literal, not untrusted input, so the
  // validation `toMoney` would perform is unneeded here anyway.
  return "0" as Money;
}

/**
 * Renders "Recommended Available Withdrawal: {Amount}" next to the
 * Withdrawal Adjustment chip (Story 4.4) -- distinct in framing (a
 * forward-looking suggestion for the *next* Take Now) from the chip (the
 * *current* cycle's status), mirroring Add Money's separate "Recommended:
 * ₹X" line next to its own Investment Adjustment chip (spec-3-5). Renders
 * nothing until `recommendedWithdrawalFor` resolves past `null`. No `ml-1
 * mt-1` margin here (unlike this file's other row lines) -- intentional, not
 * a missed copy-paste: this sits inside the shared flex row alongside
 * `<AdjustmentChip>` now, so spacing is owned by that parent's `gap-x-3`
 * instead.
 */
function RecommendedWithdrawal({ adjustment }: { adjustment: AdjustmentChipInfo | null }) {
  const recommended = recommendedWithdrawalFor(adjustment);
  if (recommended === null) return null;
  return (
    <p className="text-[12.6px] font-semibold text-ink-soft">
      Recommended Available Withdrawal: <Amount value={recommended} size="sm" />
    </p>
  );
}
