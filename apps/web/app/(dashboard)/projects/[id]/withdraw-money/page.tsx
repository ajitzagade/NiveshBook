"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  BanknoteArrowDown,
  Building2,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  User,
  Wallet,
  X,
} from "lucide-react";
import type { PartnerCanTake, PartnerWithdrawalAdjustment } from "@niveshbook/core";
import type {
  DestinationType,
  Money,
  PaymentMode,
  Project,
  WithdrawalTransaction,
} from "@niveshbook/types";
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
  SplitRow,
  StatusChip,
  toast,
  formatAmount,
  type StatusChipVariant,
} from "@niveshbook/ui";
import { getCanTake } from "@/lib/can-take";
import { getWithdrawalAdjustments } from "@/lib/withdrawal-adjustments";
import { listProjects } from "@/lib/projects";
import {
  cancelWithdrawalTransaction,
  editWithdrawalTransaction,
  listWithdrawalTransactions,
  recordWithdrawalTransaction,
} from "@/lib/withdrawal-transactions";
import { recordDestinationAllocation } from "@/lib/withdrawal-destination-allocations";
import {
  DestinationRequirementAndSharePickers,
  useDestinationProjectData,
  type DestinationProjectDataState,
} from "../destination-picker";

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
 * Story 4.11: the withdrawal currently open in the Edit Withdrawal dialog --
 * unlike `RecordWithdrawalTarget` (identified by `partyType`+`shareId`,
 * since nothing exists yet to edit), this is identified by the specific
 * `transaction` being corrected -- mirrors `add-money/page.tsx`'s
 * `EditPaymentTarget` one ledger over (no `requirementId` here, this ledger
 * is Project-scoped).
 */
interface EditWithdrawalTarget {
  transaction: WithdrawalTransaction;
}

/**
 * Story 4.11: the withdrawal currently pending confirmation in the Cancel
 * Withdrawal dialog -- mirrors `EditWithdrawalTarget`'s exact shape one
 * dialog over (identified by the specific `transaction` being cancelled).
 */
interface CancelWithdrawalTarget {
  transaction: WithdrawalTransaction;
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
 * Formats a `scaleMoneyForCompare`-scaled integer back into a plain decimal
 * string, for the destination-allocation dialog's running "Distributed:
 * ₹X / ₹Y" total (Story 4.7) -- mirrors `excessOverCanTake`'s identical
 * inline whole/fraction split, extracted here since the allocation dialog
 * needs it for a *sum* of legs, not a single subtraction. Display-only, fed
 * through `<Amount>`/`formatAmount` (never itself the authoritative
 * validated value -- the server re-validates every leg's amount via
 * `toMoney`).
 */
export function formatScaledAmount(scaled: number): string {
  const whole = Math.trunc(scaled / 100);
  const fraction = scaled % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}

/**
 * One destination leg's editable form state in the "Where did this money
 * go?" dialog (Story 4.7, FR27) -- `key` is a stable React list key
 * (`crypto.randomUUID()`, never the array index -- rows can be removed from
 * the middle), independent of any server-assigned id (none exists yet,
 * pre-save). `destinationProjectId`/`personName`/`notes` are always plain
 * strings here (never `null`) for simpler controlled-`<Input>` binding --
 * `submitAllocation` is what narrows them to `string | null` per
 * `destinationType` before calling the API, mirroring
 * `RecordWithdrawalTarget`'s form-vs-wire-shape split elsewhere in this
 * file.
 */
interface AllocationLegForm {
  key: string;
  destinationType: DestinationType;
  amount: string;
  destinationProjectId: string;
  personName: string;
  notes: string;
  /** Story 4.8 (FR28): the destination Project's chosen funding requirement -- only meaningful once `destinationType === "project"` and `destinationProjectId` is set. */
  destinationRequirementId: string;
  /** Story 4.8 (FR28): the destination Project's chosen Partner/Sub-partner Share (paired with `destinationPartyType` below). */
  destinationShareId: string;
  /** Story 4.8 (FR28): `""` means "not yet chosen" -- mirrors every other not-yet-chosen field's empty-string convention in this form. */
  destinationPartyType: "partner" | "sub_partner" | "";
}

function newAllocationLeg(amount = ""): AllocationLegForm {
  return {
    key: crypto.randomUUID(),
    destinationType: "other",
    amount,
    destinationProjectId: "",
    personName: "",
    notes: "",
    destinationRequirementId: "",
    destinationShareId: "",
    destinationPartyType: "",
  };
}

/**
 * `true` only when `leg` carries whatever type-specific field its
 * `destinationType` requires -- mirrors the route's own server-side
 * `isValidLeg` shape guard (`shared.ts`) exactly: `"project"` needs a
 * non-empty `destinationProjectId`, `"person"` a non-empty `personName`,
 * `"other"` non-empty `notes`; `"available_balance"` needs nothing extra.
 * Gates the Save button alongside `allocationMatches` -- without this, the
 * dialog's own default, unedited state (one `"other"` leg, blank `notes`)
 * would show Save as enabled and then always 400 on submit, since
 * `allocationMatches` alone only ever checks the amount sum, never these
 * fields. Exported so `page.test.tsx` can exercise it directly, mirroring
 * this file's other pure-helper-export convention (`scaleMoneyForCompare`,
 * `exceedsCanTake`, etc.).
 *
 * Story 4.8 (FR28): a `"project"` leg is additionally complete only once
 * `destinationRequirementId`/`destinationShareId`/`destinationPartyType` are
 * all chosen too -- these fields can only ever hold a non-empty value once a
 * real `<option>` was selected from `destinationProjectData`'s fetched
 * requirements/shares (never typed free-text), so a destination Project with
 * zero funding requirements naturally blocks completion here too, with no
 * separate empty-requirements check needed. Also requires a non-zero amount
 * (review finding, Story 4.8) -- unlike every other leg type, a `"project"`
 * leg now writes a REAL, permanent `investment_transactions` row at the
 * destination Project, so `"0"` isn't a legitimate "nothing went here" entry
 * here the way it is for `"other"`/`"person"`/`"available_balance"`; the
 * server's own `ZeroAmountProjectLegError` is the authoritative check either
 * way, this is purely a client-side UX nicety avoiding a pointless
 * round-trip, mirroring `scaleMoneyForCompare`'s existing decimal-safe,
 * never-`parseFloat` convention (AD-2).
 */
export function isAllocationLegComplete(leg: AllocationLegForm): boolean {
  if (leg.destinationType === "project") {
    return (
      leg.destinationProjectId.trim().length > 0 &&
      leg.destinationRequirementId.trim().length > 0 &&
      leg.destinationShareId.trim().length > 0 &&
      leg.destinationPartyType.trim().length > 0 &&
      scaleMoneyForCompare(leg.amount) > 0
    );
  }
  if (leg.destinationType === "person") return leg.personName.trim().length > 0;
  if (leg.destinationType === "other") return leg.notes.trim().length > 0;
  return true;
}

const DESTINATION_LABEL: Record<DestinationType, string> = {
  project: "Another Project",
  person: "Person",
  available_balance: "Available Balance",
  other: "Other",
};

/**
 * One colored dest-icon per `DestinationType` (DESIGN.md's "Split row"
 * component) -- distinct from the app-wide status-chip color convention
 * (epic-4-context.md: danger/violet/info groupings for *transaction-history*
 * chips elsewhere) since this dialog needs four visually distinct rows
 * side by side, not a single chip's color. `project` reuses `--color-info`
 * (the established "cross-project movement" teal); `person` reuses
 * `--color-violet` ("a transfer to a person" per that same convention);
 * `available_balance` gets `--color-accent` (this app's primary blue, kept
 * distinct from `person`'s violet so the two never read as the same
 * destination at a glance); `other` gets a neutral `--color-ink-faint`.
 */
const DESTINATION_COLOR: Record<DestinationType, string> = {
  project: "var(--color-info)",
  person: "var(--color-violet)",
  available_balance: "var(--color-accent)",
  other: "var(--color-ink-faint)",
};

function destinationIcon(type: DestinationType): ReactNode {
  switch (type) {
    case "project":
      return <Building2 size={13} />;
    case "person":
      return <User size={13} />;
    case "available_balance":
      return <Wallet size={13} />;
    case "other":
      return <MoreHorizontal size={13} />;
  }
}

type ProjectsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; projects: Project[] };

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

  // Story 4.7 (FR27): the "Where did this money go?" destination-allocation
  // dialog, opened immediately after a Take Now save succeeds (the "next
  // step in the same flow" per epic-4-context.md) -- `allocationTarget` is
  // the just-saved `WithdrawalTransaction` being allocated (`null` means the
  // dialog is closed). Skippable/dismissable without saving (this story's
  // Code Map) -- the withdrawal itself is already recorded regardless.
  const [allocationTarget, setAllocationTarget] = useState<WithdrawalTransaction | null>(null);
  const [allocationLegs, setAllocationLegs] = useState<AllocationLegForm[]>([newAllocationLeg()]);
  const [allocationFormError, setAllocationFormError] = useState<string | null>(null);
  const [allocationSubmitting, setAllocationSubmitting] = useState(false);
  // Minted once per dialog-open, mirroring `recordIdempotencyKey`'s exact
  // caller-owns-the-key-lifecycle contract one story over.
  const [allocationIdempotencyKey, setAllocationIdempotencyKey] = useState("");
  // Every other Project (for a "project" leg's destination selector,
  // excluding this Project itself -- this story's Decisions) -- fetched
  // lazily on the dialog's first open, not on page load: `GET /api/projects`
  // is Owner/Admin-only (`"projects:list"`), so eagerly calling it on every
  // page view would 403 for a Partner/Sub-partner who never opens this
  // dialog at all.
  const [projectsState, setProjectsState] = useState<ProjectsState>({ status: "loading" });
  // Story 4.8 (FR28), extracted to a shared hook in Story 4.9 (FR29) so the
  // Available Balance page's own "Invest in a Project" spend reuses the
  // identical lazy-fetch-per-destination-Project logic instead of forking a
  // second copy -- see `./destination-picker.tsx`'s own doc comment.
  const { destinationProjectData, ensureDestinationProjectData } = useDestinationProjectData();

  // Story 4.11: the Edit Withdrawal dialog -- mirrors `add-money/page.tsx`'s
  // Story 3.7 Edit Payment dialog state field-for-field, plus
  // `editIdempotencyKey` following the exact same
  // mint-once-per-logical-submission-attempt lifecycle as
  // `recordIdempotencyKey`.
  const [editTarget, setEditTarget] = useState<EditWithdrawalTarget | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editPaymentMode, setEditPaymentMode] = useState<PaymentMode>("cash");
  const [editReferenceNumber, setEditReferenceNumber] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editFormError, setEditFormError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editIdempotencyKey, setEditIdempotencyKey] = useState("");
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);

  // Story 4.11: the Cancel Withdrawal confirmation dialog -- no editable
  // fields (cancelling never changes amount/date/paymentMode/etc.), so this
  // state is narrower than Record/Edit Withdrawal's -- mirrors
  // `add-money/page.tsx`'s Story 3.8 Cancel Payment dialog state exactly.
  const [cancelTarget, setCancelTarget] = useState<CancelWithdrawalTarget | null>(null);
  const [cancelFormError, setCancelFormError] = useState<string | null>(null);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelIdempotencyKey, setCancelIdempotencyKey] = useState("");

  // Story 4.11: withdrawal ids allocated (a destination split saved) during
  // THIS browser session -- drives the Edit dialog's "amount locked" message
  // and disables its Amount field once a withdrawal has legs. There is no
  // `GET` endpoint to list a withdrawal's destination-allocation legs
  // (deliberately out of this story's own Code Map -- only the PATCH/cancel
  // routes are new), so this is a best-effort, session-local signal, not an
  // authoritative one: a withdrawal allocated in an earlier session (or by
  // another user concurrently) still submits normally here, and the
  // server's own authoritative `409 amount_locked_by_allocation` guard
  // (`packages/db`'s `editTransaction`, inside its own `FOR UPDATE` lock) is
  // what actually enforces the rule either way -- surfaced inline via
  // `editFormError` on that response, exactly like every other edit-time
  // error this page already handles. Documented in spec-4-11's
  // Implementation Notes as a deliberate, scoped decision.
  const [allocatedWithdrawalIds, setAllocatedWithdrawalIds] = useState<Set<string>>(new Set());

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
   * Opens the "Where did this money go?" destination-allocation dialog
   * (Story 4.7) for a just-saved withdrawal -- one default `"other"` leg
   * pre-filled with the full withdrawn amount (the common single-destination
   * case needs no further editing before it already satisfies the
   * Distributed check; a split still requires editing it down). Lazily
   * kicks off the Projects fetch on first open only (see `projectsState`'s
   * own doc comment).
   */
  function openAllocationDialog(withdrawal: WithdrawalTransaction) {
    setAllocationTarget(withdrawal);
    setAllocationLegs([newAllocationLeg(withdrawal.amount)]);
    setAllocationFormError(null);
    setAllocationIdempotencyKey(crypto.randomUUID());
    if (projectsState.status !== "loaded") {
      listProjects()
        .then((result) => setProjectsState({ status: "loaded", projects: result }))
        .catch((error: unknown) => {
          setProjectsState({
            status: "error",
            message: error instanceof Error ? error.message : "Something went wrong.",
          });
        });
    }
  }

  /** Dismisses the destination-allocation dialog without saving -- the withdrawal stays recorded either way (this story's Code Map: skippable/dismissable). */
  function closeAllocationDialog() {
    setAllocationTarget(null);
    setAllocationFormError(null);
  }

  function addAllocationLeg() {
    setAllocationLegs((prev) => [...prev, newAllocationLeg()]);
  }

  /** Never removes the last remaining row -- at least one leg is always present, mirroring the dialog's own "at least one destination" requirement. */
  function removeAllocationLeg(key: string) {
    setAllocationLegs((prev) => (prev.length > 1 ? prev.filter((leg) => leg.key !== key) : prev));
  }

  function updateAllocationLeg(key: string, patch: Partial<AllocationLegForm>) {
    setAllocationLegs((prev) => prev.map((leg) => (leg.key === key ? { ...leg, ...patch } : leg)));
  }

  /**
   * Saves the full destination split in one call (Story 4.7, AD-5/AD-6).
   * Narrows each form leg's `string` fields to the wire shape's
   * `string | null` here -- only the field(s) matching a leg's
   * `destinationType` are ever sent as non-null, mirroring
   * `packages/core`'s own "only the matching field is non-null" contract
   * (defense in depth -- the server re-applies this itself either way).
   */
  async function submitAllocation() {
    if (!allocationTarget) return;

    setAllocationFormError(null);
    setAllocationSubmitting(true);
    try {
      await recordDestinationAllocation(
        projectId,
        allocationTarget.id,
        allocationLegs.map((leg) => ({
          destinationType: leg.destinationType,
          amount: leg.amount,
          destinationProjectId: leg.destinationType === "project" ? leg.destinationProjectId : null,
          personName: leg.destinationType === "person" ? leg.personName.trim() || null : null,
          notes: leg.notes.trim().length > 0 ? leg.notes.trim() : null,
          destinationRequirementId: leg.destinationType === "project" ? leg.destinationRequirementId : null,
          destinationShareId: leg.destinationType === "project" ? leg.destinationShareId : null,
          destinationPartyType:
            leg.destinationType === "project" && leg.destinationPartyType ? leg.destinationPartyType : null,
        })),
        allocationIdempotencyKey,
      );
      toast.success(`Destination allocation saved for ${formatAmount(allocationTarget.amount)}`);
      // Story 4.11: this withdrawal's amount is now locked -- see
      // `allocatedWithdrawalIds`'s own doc comment above.
      setAllocatedWithdrawalIds((prev) => new Set(prev).add(allocationTarget.id));
    } catch (err) {
      setAllocationFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setAllocationSubmitting(false);
      return;
    }

    setAllocationSubmitting(false);
    closeAllocationDialog();
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
    let saved: WithdrawalTransaction;
    try {
      saved = await recordWithdrawalTransaction(
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
    // Story 4.7 (FR27): the destination-allocation prompt is "the very next
    // step in the same flow" (epic-4-context.md), not a separate screen --
    // opened immediately once the Record Withdrawal dialog above closes.
    openAllocationDialog(saved);
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

  /** Opens the Edit Withdrawal dialog, pre-filled with `transaction`'s current values (Story 4.11) -- Owner/Admin-facing only, mirroring `add-money/page.tsx`'s `openEditPaymentDialog` one ledger over. */
  function openEditWithdrawalDialog(transaction: WithdrawalTransaction) {
    setEditTarget({ transaction });
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

  function closeEditWithdrawalDialog() {
    setEditTarget(null);
  }

  /** The form's own `onSubmit` -- opens the summary-confirm step rather than submitting directly, mirroring `add-money/page.tsx`'s identical two-step pattern for money-moving actions. */
  function handleEditWithdrawalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTarget) return;
    setEditFormError(null);
    setEditConfirmOpen(true);
  }

  /**
   * Saves a corrected withdrawal (Story 4.11) -- Owner/Admin-only. Passes
   * `editIdempotencyKey` through unchanged -- minted once, when the dialog
   * opens (`openEditWithdrawalDialog`), not here -- mirrors
   * `handleConfirmEditPayment`'s identical retry-reuses-the-same-key
   * contract on the investment side.
   */
  async function handleConfirmEditWithdrawal() {
    if (!editTarget) return;

    setEditFormError(null);
    setEditSubmitting(true);
    try {
      await editWithdrawalTransaction(
        projectId,
        editTarget.transaction.id,
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
      toast.success(`Withdrawal updated to ${formatAmount(editAmount)}`);
    } catch (err) {
      setEditFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setEditSubmitting(false);
      return;
    }

    setEditSubmitting(false);
    setEditConfirmOpen(false);
    closeEditWithdrawalDialog();
    // Best-effort, mirroring `add-money/page.tsx`'s identical convention.
    await Promise.all([refreshWithdrawals().catch(() => {}), refreshAdjustments().catch(() => {})]);
  }

  /**
   * Opens the Cancel Withdrawal confirmation dialog for `transaction` (Story
   * 4.11) -- Owner/Admin-facing only, mirroring `openEditWithdrawalDialog`'s
   * Decisions one dialog over. A confirmation step precedes the actual
   * `cancelWithdrawalTransaction` call (`handleCancelWithdrawalConfirm`
   * below) -- this feels destructive even though nothing is hard-deleted,
   * mirroring `add-money/page.tsx`'s Cancel Payment dialog's identical
   * rationale. Unlike that one-table cancel, this one can cascade to a
   * linked destination Project's investment record or a reversed Available
   * Balance credit -- the dialog's own copy below calls that out.
   */
  function openCancelWithdrawalDialog(transaction: WithdrawalTransaction) {
    setCancelTarget({ transaction });
    setCancelFormError(null);
    // A fresh key for this new logical cancel attempt -- mirrors `editIdempotencyKey`'s own doc comment.
    setCancelIdempotencyKey(crypto.randomUUID());
  }

  function closeCancelWithdrawalDialog() {
    setCancelTarget(null);
  }

  /**
   * Confirms and performs the cancel (Story 4.11) -- no form fields to
   * validate (cancelling never changes amount/date/paymentMode/etc.), so
   * this is a plain confirm handler, not a form `onSubmit`, mirroring
   * `add-money/page.tsx`'s `handleCancelPaymentConfirm` one ledger over.
   */
  async function handleCancelWithdrawalConfirm() {
    if (!cancelTarget) return;

    setCancelFormError(null);
    setCancelSubmitting(true);
    try {
      await cancelWithdrawalTransaction(
        projectId,
        cancelTarget.transaction.id,
        null,
        cancelIdempotencyKey,
      );
      toast.success("Withdrawal cancelled");
    } catch (err) {
      setCancelFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setCancelSubmitting(false);
      return;
    }

    setCancelSubmitting(false);
    closeCancelWithdrawalDialog();
    // Best-effort, mirroring `add-money/page.tsx`'s identical convention --
    // a cancel can also change the Project's live Can Take (a "project" leg's
    // destination cancel, or an "available_balance" leg's reversed credit),
    // so Can Take is refreshed here too, not just Withdrawal Adjustment.
    await Promise.all([
      refreshWithdrawals().catch(() => {}),
      refreshCanTake().catch(() => {}),
      refreshAdjustments().catch(() => {}),
    ]);
  }

  // Derived once per render for the Authorize Extra Withdrawal dialog's copy
  // below (Story 4.5) -- `null` whenever `recordTarget`/Can Take aren't both
  // resolvable yet, which the dialog's own render guards against.
  const extraWithdrawalCanTake = recordTarget
    ? canTakeForTarget(recordTarget.partyType, recordTarget.shareId)
    : null;

  // Story 4.7's Distributed check (AC1): the running total of every leg's
  // `amount`, scaled-integer arithmetic (never `parseFloat`/`Number()` --
  // mirrors `exceedsCanTake`'s identical client-side-nicety rationale, the
  // server's own `moneyEquals` sum check is the authoritative one). Save
  // stays disabled until this exactly matches `allocationTarget.amount` AND
  // every leg's type-specific field is filled in (`isAllocationLegComplete`)
  // -- both gates are needed: the dialog's own default, unedited state (one
  // `"other"` leg, the full amount, blank `notes`) already satisfies the sum
  // match on its own, so without the second gate Save would appear enabled
  // and then always 400 on submit.
  const allocationTotalScaled = allocationLegs.reduce(
    (sum, leg) => sum + scaleMoneyForCompare(leg.amount),
    0,
  );
  const allocationTargetScaled = allocationTarget ? scaleMoneyForCompare(allocationTarget.amount) : 0;
  const allocationMatches =
    allocationTarget !== null &&
    allocationTotalScaled === allocationTargetScaled &&
    allocationLegs.every(isAllocationLegComplete);
  const allocationProjectOptions =
    projectsState.status === "loaded"
      ? projectsState.projects.filter((project) => project.id !== projectId)
      : [];
  // A failed `GET /api/projects` fetch (Owner/Admin-only -- see
  // `projectsState`'s own doc comment) leaves the "project" destination
  // selector showing zero options with no explanation otherwise -- surfaced
  // here so `AllocationLegRow` can render it next to that selector.
  const allocationProjectsError = projectsState.status === "error" ? projectsState.message : null;

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
                      tone="danger"
                      onClick={() => openRecordWithdrawalDialog("partner", partner.partnerId, partner.name)}
                      icon={<Minus size={14} />}
                    >
                      Record Withdrawal
                    </Button>
                  </div>
                  <RecordedWithdrawals
                    transactions={recordedWithdrawalsFor("partner", partner.partnerId)}
                    allocatedWithdrawalIds={allocatedWithdrawalIds}
                    onEdit={openEditWithdrawalDialog}
                    onCancel={openCancelWithdrawalDialog}
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
                            isSub
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
                              tone="danger"
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
                            allocatedWithdrawalIds={allocatedWithdrawalIds}
                            onEdit={openEditWithdrawalDialog}
                            onCancel={openCancelWithdrawalDialog}
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

      <Dialog
        open={allocationTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeAllocationDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>Where did this money go?</DialogTitle>
          <DialogDescription>
            Split {allocationTarget ? <Amount value={allocationTarget.amount} size="sm" /> : null} across
            one or more destinations -- another Project, a Person, Available Balance, or Other. Optional:
            skip to record the withdrawal with no allocation yet -- it stays recorded either way.
          </DialogDescription>

          <div className="mt-4 flex flex-col gap-3">
            {allocationLegs.map((leg, index) => (
              <AllocationLegRow
                key={leg.key}
                leg={leg}
                index={index}
                removable={allocationLegs.length > 1}
                projectOptions={allocationProjectOptions}
                projectsError={allocationProjectsError}
                destinationProjectData={
                  leg.destinationProjectId ? destinationProjectData[leg.destinationProjectId] : undefined
                }
                onChange={(patch) => updateAllocationLeg(leg.key, patch)}
                onRemove={() => removeAllocationLeg(leg.key)}
                onDestinationProjectSelected={ensureDestinationProjectData}
              />
            ))}
          </div>

          <div className="mt-3">
            <Button type="button" variant="ghost" tone="accent" onClick={addAllocationLeg} icon={<Plus size={14} />}>
              Add destination
            </Button>
          </div>

          <div className="mt-4">
            <DistributedCheck
              label="Distributed"
              status={
                <>
                  {formatAmount(formatScaledAmount(allocationTotalScaled))} /{" "}
                  {allocationTarget ? formatAmount(allocationTarget.amount) : "₹0"}
                  {allocationMatches ? " ✓" : ""}
                </>
              }
            />
          </div>

          {allocationFormError ? (
            <p role="alert" className="mt-4 text-[13.4px] text-danger">
              {allocationFormError}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2.5">
            <Button
              type="button"
              onClick={submitAllocation}
              disabled={!allocationMatches || allocationSubmitting}
              icon={<Save size={14} />}
            >
              {allocationSubmitting ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={closeAllocationDialog}
              disabled={allocationSubmitting}
              icon={<X size={14} />}
            >
              Skip
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeEditWithdrawalDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>Edit Withdrawal</DialogTitle>
          <DialogDescription>
            Owner/Admin only. The previous values, who changed it, and when, are preserved in the audit
            trail -- this updates the recorded withdrawal in place, it never creates a new row.
            {editTarget && allocatedWithdrawalIds.has(editTarget.transaction.id) ? (
              <>
                {" "}
                Amount can no longer be edited -- a destination allocation has already been recorded for
                this withdrawal, and its legs must keep summing to the withdrawal&apos;s own amount. Date,
                payment mode, reference number, and notes can still be edited.
              </>
            ) : null}
          </DialogDescription>
          <form onSubmit={handleEditWithdrawalSubmit} className="mt-4">
            <Field>
              <Label htmlFor="edit-wtx-amount">Amount</Label>
              <Input
                id="edit-wtx-amount"
                name="amount"
                inputMode="decimal"
                value={editAmount}
                onChange={(event) => setEditAmount(event.target.value)}
                required
                autoFocus
                disabled={editTarget !== null && allocatedWithdrawalIds.has(editTarget.transaction.id)}
              />
              <Helper>0 is accepted -- no forced withdrawal.</Helper>
            </Field>
            <Field>
              <Label htmlFor="edit-wtx-date">Date</Label>
              <Input
                id="edit-wtx-date"
                name="transactionDate"
                type="date"
                value={editDate}
                onChange={(event) => setEditDate(event.target.value)}
                required
              />
            </Field>
            <Field>
              <Label htmlFor="edit-wtx-payment-mode">Payment Mode</Label>
              <select
                id="edit-wtx-payment-mode"
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
              <Label htmlFor="edit-wtx-reference">Reference Number</Label>
              <Input
                id="edit-wtx-reference"
                name="referenceNumber"
                value={editReferenceNumber}
                onChange={(event) => setEditReferenceNumber(event.target.value)}
              />
              <Helper>Optional -- e.g. a cash withdrawal often has none.</Helper>
            </Field>
            <Field>
              <Label htmlFor="edit-wtx-notes">Notes</Label>
              <Input
                id="edit-wtx-notes"
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
                onClick={closeEditWithdrawalDialog}
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
            Update this withdrawal to <strong>{formatAmount(editAmount)}</strong> on{" "}
            <strong>{editDate}</strong> via <strong>{PAYMENT_MODE_LABELS[editPaymentMode]}</strong>
            {editReferenceNumber.trim() ? (
              <>
                {" "}
                (Ref: <strong>{editReferenceNumber.trim()}</strong>)
              </>
            ) : null}
            ? The previous values, who changed it, and when, are preserved in the audit trail.
          </DialogDescription>

          {editFormError ? (
            <p role="alert" className="mt-4 text-[13.4px] text-danger">
              {editFormError}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2.5">
            <Button
              type="button"
              onClick={handleConfirmEditWithdrawal}
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
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeCancelWithdrawalDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>Cancel this withdrawal?</DialogTitle>
          <DialogDescription>
            {cancelTarget ? (
              <>
                Cancel the <strong>{formatAmount(cancelTarget.transaction.amount)}</strong> withdrawal
                from <strong>{cancelTarget.transaction.transactionDate}</strong> (
                {PAYMENT_MODE_LABELS[cancelTarget.transaction.paymentMode]})?{" "}
              </>
            ) : null}
            Owner/Admin only. The original record is preserved with a &quot;Cancelled&quot; status and a
            linked reversal record is created -- nothing is deleted. If this withdrawal was allocated to
            another Project, that Project&apos;s own investment record is also cancelled; if it was
            allocated to Available Balance, the credited pool is reversed (rejected instead if that pool
            was already spent elsewhere -- nothing changes in that case, and this withdrawal stays active).
          </DialogDescription>

          {cancelFormError ? (
            <p role="alert" className="mt-4 text-[13.4px] text-danger">
              {cancelFormError}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2.5">
            <Button
              type="button"
              onClick={handleCancelWithdrawalConfirm}
              disabled={cancelSubmitting}
              icon={<Ban size={14} />}
            >
              {cancelSubmitting ? "Cancelling…" : "Confirm Cancel"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={closeCancelWithdrawalDialog}
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

/**
 * One editable destination-split row in the "Where did this money go?"
 * dialog (Story 4.7, extended by Story 4.8/FR28) -- a `destinationType`
 * selector, `SplitRow`'s colored dest-icon + label + amount input
 * (DESIGN.md's "Split row" component, reused verbatim per
 * epic-4-context.md), plus whichever type-specific field(s) apply
 * (`destinationProjectId`'s Project selector for `"project"`, plus (Story
 * 4.8) that destination Project's funding-requirement and Partner/
 * Sub-partner Share selectors once chosen; `personName`'s free-text input
 * for `"person"`), and an always-present optional `notes` field (this
 * story's Decisions: usable on any leg, required in practice for `"other"`
 * -- enforced server-side, not specially marked here). `onRemove` is only
 * ever rendered when `removable` (at least one leg must always remain --
 * `removeAllocationLeg`'s own guard).
 */
function AllocationLegRow({
  leg,
  index,
  removable,
  projectOptions,
  projectsError,
  destinationProjectData,
  onChange,
  onRemove,
  onDestinationProjectSelected,
}: {
  leg: AllocationLegForm;
  index: number;
  removable: boolean;
  projectOptions: Project[];
  /** Set when `GET /api/projects` failed -- rendered as a visible `role="alert"` next to the Project selector below, instead of that selector silently showing zero options. */
  projectsError: string | null;
  /** Story 4.8: `leg.destinationProjectId`'s already-fetched (or in-flight/errored) requirement/Share data -- `undefined` until a Project is chosen and its fetch has been kicked off. */
  destinationProjectData: DestinationProjectDataState | undefined;
  onChange: (patch: Partial<AllocationLegForm>) => void;
  onRemove: () => void;
  /** Story 4.8: kicks off (or no-ops if already started) the fetch for a newly-chosen destination Project id. */
  onDestinationProjectSelected: (destinationProjectId: string) => void;
}) {
  // Disambiguates every field's `aria-label` across multiple rows (e.g.
  // "Amount (Destination 1)" vs "Amount (Destination 2)") -- without this,
  // every row's inputs share the exact same label, which is both an
  // accessibility problem (assistive tech can't announce which row a field
  // belongs to) and a testing one (forces `getAllByLabelText(...)[n]`
  // instead of a direct, unambiguous lookup).
  const rowLabel = `Destination ${index + 1}`;

  return (
    <div className="rounded-el border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <select
          aria-label={`Destination type (${rowLabel})`}
          className="rounded-el border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft"
          value={leg.destinationType}
          onChange={(event) => onChange({ destinationType: event.target.value as DestinationType })}
        >
          {(Object.entries(DESTINATION_LABEL) as [DestinationType, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {removable ? (
          <Button type="button" variant="ghost" onClick={onRemove} icon={<X size={14} />}>
            Remove
          </Button>
        ) : null}
      </div>

      <SplitRow
        icon={destinationIcon(leg.destinationType)}
        iconColor={DESTINATION_COLOR[leg.destinationType]}
        label={DESTINATION_LABEL[leg.destinationType]}
        input={
          <Input
            aria-label={`Amount (${rowLabel})`}
            inputMode="decimal"
            value={leg.amount}
            onChange={(event) => onChange({ amount: event.target.value })}
          />
        }
      />

      {leg.destinationType === "project" ? (
        <div className="mt-2">
          <select
            aria-label={`Destination Project (${rowLabel})`}
            className="w-full rounded-el border border-border bg-surface px-3 py-2.5 text-[14px] text-ink focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft"
            value={leg.destinationProjectId}
            onChange={(event) => {
              const destinationProjectId = event.target.value;
              // A different Project's requirement/Share ids are meaningless
              // once the Project itself changes -- reset both (Story 4.8),
              // mirroring how choosing a fresh destinationType elsewhere in
              // this form always starts that leg's type-specific fields over.
              onChange({
                destinationProjectId,
                destinationRequirementId: "",
                destinationShareId: "",
                destinationPartyType: "",
              });
              if (destinationProjectId) onDestinationProjectSelected(destinationProjectId);
            }}
          >
            <option value="">Select a Project…</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {projectsError ? (
            <p role="alert" className="mt-1 text-[12.6px] text-danger">
              Couldn&apos;t load Projects: {projectsError}
            </p>
          ) : null}

          {leg.destinationProjectId ? (
            <DestinationRequirementAndSharePickers
              rowLabel={rowLabel}
              leg={leg}
              projectName={
                projectOptions.find((project) => project.id === leg.destinationProjectId)?.name ??
                "This Project"
              }
              data={destinationProjectData}
              onChange={onChange}
            />
          ) : null}
        </div>
      ) : null}

      {leg.destinationType === "person" ? (
        <div className="mt-2">
          <Input
            aria-label={`Person's name (${rowLabel})`}
            placeholder="Person's name"
            value={leg.personName}
            onChange={(event) => onChange({ personName: event.target.value })}
          />
        </div>
      ) : null}

      <div className="mt-2">
        <Input
          aria-label={`Notes (${rowLabel})`}
          placeholder={leg.destinationType === "other" ? "Describe this destination" : "Notes (optional)"}
          value={leg.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </div>
    </div>
  );
}

/**
 * The recorded-withdrawals list shown under a Partner/Sub-partner's Can Take
 * row once withdrawals exist for them on this Project (Story 4.2) -- Date,
 * Amount, Payment Mode, mirroring `add-money/page.tsx`'s `RecordedPayments`
 * one ledger over.
 *
 * Story 4.11 adds an Edit pencil/Cancel ban affordance per row (Owner/Admin-
 * facing only -- the API itself gates the rest, matching every other
 * affordance on this page), a "Cancelled" `StatusChip` (reusing
 * `packages/ui`'s component, mirroring `RecordedPayments`'s identical
 * `danger`-variant treatment) for any row whose `status` is already
 * `"cancelled"` -- labeled "(reversal)" for the linked reversal row itself,
 * so the two are never confused (mirrors FR42's "self-explanatory audit
 * trail" one ledger over) -- and hides both affordances entirely for an
 * already-cancelled row, since there's nothing left to edit or cancel.
 *
 * Renders nothing when there's nothing to show (no fetch-state handling here
 * -- `recordedWithdrawalsFor` already resolves "not loaded yet" to `[]`).
 */
function RecordedWithdrawals({
  transactions,
  allocatedWithdrawalIds,
  onEdit,
  onCancel,
}: {
  transactions: WithdrawalTransaction[];
  /** Story 4.11: withdrawal ids allocated during this session -- see `allocatedWithdrawalIds`'s own doc comment on the page component. */
  allocatedWithdrawalIds: Set<string>;
  onEdit: (transaction: WithdrawalTransaction) => void;
  onCancel: (transaction: WithdrawalTransaction) => void;
}) {
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
          {transaction.status === "cancelled" ? (
            <StatusChip variant="danger">
              Cancelled{transaction.reversalOfTransactionId ? " (reversal)" : ""}
            </StatusChip>
          ) : null}
          {transaction.status === "active" ? (
            <Button variant="ghost" tone="accent" onClick={() => onEdit(transaction)} icon={<Pencil size={12} />}>
              Edit
            </Button>
          ) : null}
          {transaction.status === "active" ? (
            <Button variant="ghost" tone="danger" onClick={() => onCancel(transaction)} icon={<Ban size={12} />}>
              Cancel
            </Button>
          ) : null}
          {transaction.status === "active" && allocatedWithdrawalIds.has(transaction.id) ? (
            <span className="text-ink-faint">(amount locked -- destination allocated)</span>
          ) : null}
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
