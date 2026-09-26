"use client";

import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, History, Search, X } from "lucide-react";
import type {
  AuditLogEntry,
  MoneyHistoryEntry,
  MoneyTrailNode,
  MoneyTrailNodeType,
  Project,
} from "@niveshbook/types";
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
  Input,
  Label,
  PageHeader,
  RowCard,
  StatusChip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  Th,
  Td,
  Trail,
  TrailItem,
  TraceBanner,
} from "@niveshbook/ui";
import { getMoneyHistory, getTrailStartFromEntry, type MoneyHistoryFiltersInput } from "@/lib/money-history";
import { getMoneyTrail } from "@/lib/money-trail";
import { mapMoneyHistoryEntryToRowCard, PAYMENT_MODE_LABELS } from "@/lib/money-history-row-card";
import { ENTRY_TYPE_LABELS, describeTrailNode, flattenTrail } from "@/lib/money-trail-view";
import { listProjects } from "@/lib/projects";
import { getInvestmentTransactionAuditLog } from "@/lib/investment-transactions";
import { getWithdrawalAuditLog } from "@/lib/withdrawal-transactions";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; entries: MoneyHistoryEntry[] };

type TraceState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; trail: MoneyTrailNode };

/**
 * Story 5.9's post-review fix (spec-5-9's Spec Change Log): the Partner/
 * Sub-partner self-access "View Audit History" entry point, moved here from
 * Add Money/Withdraw Money (which turned out unreachable by that role -- see
 * `apps/web/app/(dashboard)/layout.tsx`'s `auditHistory` nav item's own doc
 * comment for the full story). Only ever shown for a `"money_added"`/
 * `"money_withdrawn"` row -- those are the only two `MoneyHistoryEntry` types
 * whose `id` is a real, directly-queryable `investment_transactions`/
 * `withdrawal_transactions` row id (every other type is leg-derived from a
 * withdrawal, per `MoneyHistoryEntry.id`'s own doc comment -- out of scope
 * for this fix, which only needed to restore the two entry points that
 * existed before).
 */
interface AuditTarget {
  type: "money_added" | "money_withdrawn";
  projectId: string;
  transactionId: string;
}

/** The View Audit History dialog's own fetch state -- mirrors the shape `add-money/page.tsx`'s dialog used before this action moved here. */
type AuditLogState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; entries: AuditLogEntry[]; linkedTransactionId: string | null; linkedEntries: AuditLogEntry[] };

interface FilterFormState {
  dateFrom: string;
  dateTo: string;
  projectId: string;
  personName: string;
}

const EMPTY_FILTERS: FilterFormState = { dateFrom: "", dateTo: "", projectId: "", personName: "" };

/**
 * Money History (Story 5.1, FR31; trail navigation Story 5.2, FR32): the
 * unified, plain-language, filterable transaction log spanning Add Money,
 * Withdraw Money, Movement, and Available Balance activity -- reads
 * `GET /api/money-history`, which is already correctly scoped for all three
 * roles (`authorizeScope`'s grant, `resolveMoneyHistoryScope`'s per-row
 * scoping). This page itself is only reachable today via the Owner/Admin-
 * gated dashboard shell (`requireOwnerAdminSession()`) -- a Partner/
 * Sub-partner's own reachable self-service view of this same, already-scoped
 * API is Story 5.4-5.6's job (spec-5-1's Decisions #1), not this one's.
 *
 * Not Project-scoped (mirrors the API's own design) -- a Project `<select>`
 * filter narrows the list instead, the established precedent for a Project
 * picker on a non-Project-scoped screen (spec-5-1's Code Map).
 *
 * Trace mode (Story 5.2): `?traceType=X&traceId=Y` in the URL swaps this
 * page's content area from the flat list/filters to `TraceBanner` + `Trail`
 * (spec-5-2's Decisions #1 -- an in-place swap, not a dedicated route/page).
 * Clicking any row sets those params (every Money History entry type maps to
 * exactly one startable `MoneyTrailNodeType`, `apps/web/lib/money-history.ts`'s
 * `getTrailStartFromEntry`); "Back to list" clears them, preserving every
 * other query param untouched. The flat-list filters themselves stay local
 * component state (this page's existing, unchanged Story 5.1 pattern, not
 * URL-driven) -- since entering/leaving trace mode is a same-route
 * client-side navigation, that state survives the round trip on its own,
 * with no extra plumbing needed to satisfy "existing filters preserved".
 */
export default function MoneyHistoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [state, setState] = useState<ListState>({ status: "loading" });
  const [projects, setProjects] = useState<Project[]>([]);
  const [formFilters, setFormFilters] = useState<FilterFormState>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FilterFormState>(EMPTY_FILTERS);
  const [traceState, setTraceState] = useState<TraceState>({ status: "loading" });

  // Story 5.9's post-review fix: the View Audit History dialog -- read-only,
  // no form fields of its own, mirrors `add-money/page.tsx`'s original
  // `auditTarget`/`auditState` shape before this action moved here.
  const [auditTarget, setAuditTarget] = useState<AuditTarget | null>(null);
  const [auditState, setAuditState] = useState<AuditLogState>({ status: "loading" });

  const traceType = searchParams.get("traceType");
  const traceId = searchParams.get("traceId");
  const isTracing = Boolean(traceType && traceId);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((result) => {
        if (!cancelled) setProjects(result);
      })
      .catch(() => {
        // Best-effort only -- a failed fetch just means the Project filter's
        // <select> has no options beyond "All Projects"; the list itself
        // still loads independently below.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh(filters: FilterFormState) {
    setState({ status: "loading" });
    try {
      const query: MoneyHistoryFiltersInput = {
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        projectId: filters.projectId || undefined,
        personName: filters.personName || undefined,
      };
      const result = await getMoneyHistory(query);
      setState({ status: "loaded", entries: result.entries });
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
    // an async IIFE satisfies the rule, mirroring `available-balance/page.tsx`'s
    // identical `refreshBalances` precedent.
    void (async () => {
      await refresh(appliedFilters);
    })();
  }, [appliedFilters]);

  async function fetchTrail(type: string, id: string) {
    setTraceState({ status: "loading" });
    try {
      const result = await getMoneyTrail(type as MoneyTrailNodeType, id);
      setTraceState({ status: "loaded", trail: result.trail });
    } catch (error) {
      setTraceState({
        status: "error",
        message: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }

  useEffect(() => {
    if (!isTracing || !traceType || !traceId) {
      return;
    }
    // `fetchTrail` is a component-scoped function whose body sets state --
    // nesting the call inside an async IIFE satisfies
    // `react-hooks/set-state-in-effect`, mirroring this same page's own
    // `refresh`/`appliedFilters` effect immediately above.
    void (async () => {
      await fetchTrail(traceType, traceId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `isTracing` is derived from `traceType`/`traceId`, re-running on either is enough.
  }, [traceType, traceId]);

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters(formFilters);
  }

  function handleClearFilters() {
    setFormFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  }

  function handleTraceEntry(entry: MoneyHistoryEntry) {
    // Story 5.3 (FR33/FR34, AD-4): `getTrailStartFromEntry` returns `null`
    // for an `"adjustment"` entry -- nothing to trace. The row itself never
    // gets the `onClick` that would call this in the first place (see the
    // `isTraceable` guard below), so this is defense in depth, not the
    // primary gate.
    const start = getTrailStartFromEntry(entry);
    if (!start) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("traceType", start.type);
    params.set("traceId", start.id);
    router.push(`/money-history?${params.toString()}`);
  }

  function handleBackToList() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("traceType");
    params.delete("traceId");
    const query = params.toString();
    router.push(query ? `/money-history?${query}` : "/money-history");
  }

  /**
   * Opens the View Audit History dialog for a `"money_added"`/
   * `"money_withdrawn"` row (Story 5.9's post-review fix) -- calls
   * `event.stopPropagation()` first: this button renders inside a
   * `<TableRow>` that already has its own `onClick` (`handleTraceEntry`,
   * for trace navigation), so without stopping propagation, clicking this
   * button would ALSO navigate into trace mode underneath the dialog. Picks
   * the flat investment/withdrawal audit-log route by `entry.type` -- each
   * entry's own `id`/`projectId` (never a `requirementId`, which
   * `MoneyHistoryEntry` doesn't carry) is enough for either.
   */
  function openAuditDialog(event: MouseEvent, entry: MoneyHistoryEntry) {
    event.stopPropagation();
    if (entry.type !== "money_added" && entry.type !== "money_withdrawn") {
      return;
    }
    setAuditTarget({ type: entry.type, projectId: entry.projectId, transactionId: entry.id });
    setAuditState({ status: "loading" });
    const fetchAuditLog =
      entry.type === "money_added"
        ? getInvestmentTransactionAuditLog(entry.projectId, entry.id)
        : getWithdrawalAuditLog(entry.projectId, entry.id);
    fetchAuditLog
      .then((result) => {
        setAuditState({
          status: "loaded",
          entries: result.entries,
          linkedTransactionId: result.linkedTransactionId,
          linkedEntries: result.linkedEntries,
        });
      })
      .catch((error: unknown) => {
        setAuditState({
          status: "error",
          message: error instanceof Error ? error.message : "Something went wrong.",
        });
      });
  }

  function closeAuditDialog() {
    setAuditTarget(null);
  }

  if (isTracing) {
    return (
      <div>
        <PageHeader
          title="Money History"
          description="Every Add Money, Withdraw Money, Movement, and Available Balance event, in one plain-language list."
        />

        <TraceBanner
          action={
            <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={handleBackToList}>
              Back to list
            </Button>
          }
        >
          Showing where this money went
        </TraceBanner>

        <Card className="mt-3.5">
          {traceState.status === "loading" ? (
            <p className="text-[13.4px] text-ink-soft">Loading trail…</p>
          ) : traceState.status === "error" ? (
            <p role="alert" className="text-[13.4px] text-danger">
              {traceState.message}
            </p>
          ) : (
            <Trail>
              {flattenTrail(traceState.trail).map((node) => {
                const { dotColor, what, meta } = describeTrailNode(node);
                return (
                  <TrailItem
                    key={`${node.type}:${node.id}`}
                    dotColor={dotColor}
                    what={what}
                    meta={meta}
                    amount={node.amount}
                  />
                );
              })}
            </Trail>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Money History"
        description="Every Add Money, Withdraw Money, Movement, and Available Balance event, in one plain-language list."
      />

      <Card className="mb-5">
        <form onSubmit={handleFilterSubmit} className="flex flex-wrap items-end gap-3.5">
          <Field className="mb-0 min-w-[140px]">
            <Label htmlFor="mh-date-from">From</Label>
            <Input
              id="mh-date-from"
              type="date"
              value={formFilters.dateFrom}
              onChange={(event) => setFormFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
            />
          </Field>
          <Field className="mb-0 min-w-[140px]">
            <Label htmlFor="mh-date-to">To</Label>
            <Input
              id="mh-date-to"
              type="date"
              value={formFilters.dateTo}
              onChange={(event) => setFormFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
            />
          </Field>
          <Field className="mb-0 min-w-[180px]">
            <Label htmlFor="mh-project">Project</Label>
            <select
              id="mh-project"
              className="w-full rounded-el border border-border bg-surface px-3 py-2.5 text-[14px] text-ink focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft"
              value={formFilters.projectId}
              onChange={(event) => setFormFilters((prev) => ({ ...prev, projectId: event.target.value }))}
            >
              <option value="">All Projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
          <Field className="mb-0 min-w-[180px]">
            <Label htmlFor="mh-person">Person</Label>
            <Input
              id="mh-person"
              value={formFilters.personName}
              onChange={(event) => setFormFilters((prev) => ({ ...prev, personName: event.target.value }))}
              placeholder="Search by name"
            />
          </Field>
          <div className="flex gap-2.5">
            <Button type="submit" icon={<Search size={14} />}>
              Filter
            </Button>
            <Button type="button" variant="ghost" tone="accent" onClick={handleClearFilters}>
              Clear
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        {state.status === "loading" ? (
          <p className="text-[13.4px] text-ink-soft">Loading Money History…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.entries.length === 0 ? (
          <EmptyState
            icon={<History size={22} />}
            title="No Money History yet"
            description="Add Money, Withdraw Money, Movement, and Available Balance activity will show up here as it happens."
          />
        ) : (
          <>
            {/*
              Desktop (>=860px): the existing Table, byte-for-byte unchanged
              other than this new wrapping div (spec-mobile-responsive-
              phase2-table-cards) -- hidden below 860px, where the RowCard
              stack below takes over instead.
            */}
            <div className="max-[860px]:hidden">
              <Table>
                <TableHead>
                  <TableRow>
                    <Th className="!text-left">Date</Th>
                    <Th className="!text-left">What Happened</Th>
                    <Th className="!text-left">Project</Th>
                    <Th className="!text-left">Person</Th>
                    <Th>Amount</Th>
                    <Th className="!text-left">Payment Mode</Th>
                    <Th className="!text-left">From</Th>
                    <Th className="!text-left">To</Th>
                    <Th className="!text-left">Notes</Th>
                    <Th className="!text-left">Audit</Th>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {state.entries.map((entry) => {
                    // Story 5.3 (FR33/FR34, AD-4): an "adjustment" entry (a
                    // netting audit record) has no linked money movement to
                    // trace -- omit the row's click/hover trace affordance
                    // entirely for these rows, rather than sending the actor
                    // into a trace that goes nowhere.
                    const isTraceable = entry.type !== "adjustment";
                    // Story 5.9's post-review fix: only a `"money_added"`/
                    // `"money_withdrawn"` row's `id` is a real, directly-
                    // queryable investment/withdrawal transaction id -- see
                    // `AuditTarget`'s own doc comment above.
                    const isAuditable = entry.type === "money_added" || entry.type === "money_withdrawn";
                    return (
                      <TableRow
                        key={entry.id}
                        className={isTraceable ? "cursor-pointer hover:bg-surface-alt" : undefined}
                        onClick={isTraceable ? () => handleTraceEntry(entry) : undefined}
                        title={isTraceable ? "View this entry's money trail" : undefined}
                      >
                      <Td className="!text-left text-ink-soft">{entry.date}</Td>
                      <Td className="!text-left">
                        <span className="inline-flex items-center gap-1.5">
                          {ENTRY_TYPE_LABELS[entry.type]}
                          {entry.status === "cancelled" ? (
                            <StatusChip variant="danger">
                              Cancelled{entry.reversalOfTransactionId ? " (reversal)" : ""}
                            </StatusChip>
                          ) : null}
                        </span>
                      </Td>
                      <Td className="!text-left">{entry.projectName}</Td>
                      <Td className="!text-left">{entry.personName ?? "—"}</Td>
                      <Td>
                        <Amount value={entry.amount} size="sm" />
                      </Td>
                      <Td className="!text-left text-ink-soft">
                        {entry.paymentMode ? (PAYMENT_MODE_LABELS[entry.paymentMode] ?? entry.paymentMode) : "—"}
                      </Td>
                      <Td className="!text-left text-ink-soft">{entry.from ?? "—"}</Td>
                      <Td className="!text-left text-ink-soft">{entry.to ?? "—"}</Td>
                      <Td className="!text-left text-ink-soft">{entry.notes ?? "—"}</Td>
                      <Td className="!text-left">
                        {isAuditable ? (
                          // Default action -> accent (Decision 1's tone map,
                          // founder feedback 2026-09-26).
                          <Button
                            variant="ghost"
                            tone="accent"
                            onClick={(event) => openAuditDialog(event, entry)}
                            icon={<History size={12} />}
                          >
                            View Audit History
                          </Button>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </Td>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/*
              Below 860px: one RowCard per entry (spec-mobile-responsive-
              phase2-table-cards, Decision #2/#3) -- the shared
              `mapMoneyHistoryEntryToRowCard` helper supplies the 9 columns
              shared with Reports' `EntryRowsTable`; the "Audit" action (not
              a shared column) is wired onto RowCard's own `action` slot
              here, and the row-click trace navigation carries over onto
              RowCard's `onClick`, exactly mirroring the desktop TableRow's
              own `isTraceable`/`isAuditable` gating above.
            */}
            <div className="hidden max-[860px]:block" data-testid="money-history-row-cards">
              {state.entries.map((entry) => {
                const isTraceable = entry.type !== "adjustment";
                const isAuditable = entry.type === "money_added" || entry.type === "money_withdrawn";
                const { title, badge, fields } = mapMoneyHistoryEntryToRowCard(entry);
                return (
                  <RowCard
                    key={entry.id}
                    title={title}
                    badge={badge}
                    fields={fields}
                    onClick={isTraceable ? () => handleTraceEntry(entry) : undefined}
                    hint={isTraceable ? "View this entry's money trail" : undefined}
                    action={
                      isAuditable ? (
                        <Button
                          variant="ghost"
                          tone="accent"
                          onClick={(event) => openAuditDialog(event, entry)}
                          icon={<History size={12} />}
                        >
                          View Audit History
                        </Button>
                      ) : (
                        // Mirrors the desktop table's own "—" fallback for a
                        // non-auditable row's Audit column (review fix: no
                        // silent data loss between the two renders).
                        <span className="text-ink-faint">—</span>
                      )
                    }
                  />
                );
              })}
            </div>
          </>
        )}
      </Card>

      <Dialog
        open={auditTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeAuditDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>Audit History</DialogTitle>
          <DialogDescription>
            Every recorded change to this{" "}
            {auditTarget?.type === "money_withdrawn" ? "withdrawal" : "payment"} -- who, when, and why.
          </DialogDescription>
          <div className="mt-4">
            <AuditHistoryEntries state={auditState} />
          </div>
          <div className="mt-4 flex gap-2.5">
            <Button type="button" variant="ghost" onClick={closeAuditDialog} icon={<X size={14} />}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Renders one View Audit History dialog's fetched entries (Story 5.9's
 * post-review fix) -- mirrors the shape `add-money/page.tsx`'s/
 * `withdraw-money/page.tsx`'s own dialogs used before this action moved
 * here (each page kept its own copy, per this codebase's established
 * per-page local-component convention). A cancel+reversal pair (Decision
 * #5) renders as two sections: the requested transaction's own entries and,
 * only when a link exists, "Linked Transaction" (the reversal, or the
 * original if the requested transaction IS a reversal).
 */
function AuditHistoryEntries({ state }: { state: AuditLogState }) {
  if (state.status === "loading") {
    return <p className="text-[13.4px] text-ink-soft">Loading audit history…</p>;
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="text-[13.4px] text-danger">
        {state.message}
      </p>
    );
  }
  if (state.entries.length === 0 && state.linkedEntries.length === 0) {
    return <p className="text-[13.4px] text-ink-soft">No audit history yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <AuditHistoryEntryList entries={state.entries} />
      {state.linkedTransactionId ? (
        <div>
          <p className="mb-1.5 text-[12.6px] font-semibold text-ink-soft">
            Linked Transaction
          </p>
          <AuditHistoryEntryList entries={state.linkedEntries} />
        </div>
      ) : null}
    </div>
  );
}

const AUDIT_ACTION_LABEL: Record<string, string> = {
  create: "Created",
  edit: "Edited",
  cancel: "Cancelled",
};

function AuditHistoryEntryList({ entries }: { entries: AuditLogEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-[12.6px] text-ink-faint">No entries of its own.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li key={entry.id} className="border-l-2 border-border pl-2.5 text-[12.6px]">
          <p className="font-semibold text-ink">{AUDIT_ACTION_LABEL[entry.action] ?? entry.action}</p>
          <p className="text-ink-soft">{new Date(entry.createdAt).toLocaleString()}</p>
          {entry.reason ? <p className="text-ink-soft">Reason: {entry.reason}</p> : null}
        </li>
      ))}
    </ul>
  );
}
