"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, History, Search } from "lucide-react";
import type { MoneyHistoryEntry, MoneyTrailNode, MoneyTrailNodeType, Project } from "@niveshbook/types";
import {
  Amount,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Label,
  PageHeader,
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
import { ENTRY_TYPE_LABELS, describeTrailNode, flattenTrail } from "@/lib/money-trail-view";
import { listProjects } from "@/lib/projects";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; entries: MoneyHistoryEntry[] };

type TraceState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; trail: MoneyTrailNode };

const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  cheque: "Cheque",
  neft: "NEFT",
  rtgs: "RTGS",
  imps: "IMPS",
  upi: "UPI",
  bank_transfer: "Bank Transfer",
  other: "Other",
};

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
    const start = getTrailStartFromEntry(entry);
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
          Trace: {traceType} · {traceId}
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
            <Button type="button" variant="ghost" onClick={handleClearFilters}>
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
              </TableRow>
            </TableHead>
            <TableBody>
              {state.entries.map((entry) => (
                <TableRow
                  key={entry.id}
                  className="cursor-pointer hover:bg-surface-alt"
                  onClick={() => handleTraceEntry(entry)}
                  title="View this entry's money trail"
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
