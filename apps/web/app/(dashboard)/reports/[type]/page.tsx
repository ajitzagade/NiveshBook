"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import type { MoneyHistoryEntry, Project } from "@niveshbook/types";
import type {
  AvailableBalanceReportRow,
  PartnerReportRow,
  PaymentModeReportRow,
  ProjectMoneyReportRow,
  SubPartnerReportRow,
} from "@niveshbook/core";
import {
  Amount,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
} from "@niveshbook/ui";
import { getReport, type ReportFiltersInput, type ReportRow } from "@/lib/reports";
import { getReportDefinition, type ReportSlug } from "@/lib/report-catalog";
import { ENTRY_TYPE_LABELS } from "@/lib/money-trail-view";
import { exportReportToExcel, exportReportToPdf } from "@/lib/report-export";
import { listProjects } from "@/lib/projects";

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

/**
 * Postgres's `numeric(7,4)` `sharePercent` column round-trips padded
 * (`"33.33"` reads back `"33.3300"`) -- trims trailing fractional zeros for
 * display only, mirroring `home/page.tsx`'s own `formatSharePercent`
 * (duplicated locally per this codebase's established per-module
 * local-helper convention for this exact function).
 */
function formatSharePercent(raw: string): string {
  if (!raw.includes(".")) {
    return raw;
  }
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

interface FilterFormState {
  dateFrom: string;
  dateTo: string;
  projectId: string;
  personName: string;
}

const EMPTY_FILTERS: FilterFormState = { dateFrom: "", dateTo: "", projectId: "", personName: "" };

type ViewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; rows: ReportRow[] };

function EntryRowsTable({ rows }: { rows: MoneyHistoryEntry[] }) {
  return (
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
        {rows.map((entry) => (
          <TableRow key={entry.id}>
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
  );
}

function PaymentModeTable({ rows }: { rows: PaymentModeReportRow[] }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <Th className="!text-left">Payment Mode</Th>
          <Th>Total Amount</Th>
          <Th>Entries</Th>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.paymentMode}>
            <Td className="!text-left">{PAYMENT_MODE_LABELS[row.paymentMode] ?? row.paymentMode}</Td>
            <Td>
              <Amount value={row.totalAmount} size="sm" />
            </Td>
            <Td>{row.entryCount}</Td>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ProjectMoneyTable({ rows }: { rows: ProjectMoneyReportRow[] }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <Th className="!text-left">Project</Th>
          <Th>Money Added</Th>
          <Th>Money Withdrawn</Th>
          <Th>Available Balance</Th>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.projectId}>
            <Td className="!text-left">{row.projectName}</Td>
            <Td>
              <Amount value={row.totalAdded} size="sm" />
            </Td>
            <Td>
              <Amount value={row.totalWithdrawn} size="sm" />
            </Td>
            <Td>
              <Amount value={row.totalAvailableBalance} size="sm" />
            </Td>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PartnerTable({ rows }: { rows: PartnerReportRow[] }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <Th className="!text-left">Partner</Th>
          <Th className="!text-left">Project</Th>
          <Th>Share %</Th>
          <Th>Money Added</Th>
          <Th>Money Withdrawn</Th>
          <Th>Available Balance</Th>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.partnerId}>
            <Td className="!text-left">{row.name}</Td>
            <Td className="!text-left">{row.projectName}</Td>
            <Td>{formatSharePercent(row.sharePercent)}%</Td>
            <Td>
              <Amount value={row.totalAdded} size="sm" />
            </Td>
            <Td>
              <Amount value={row.totalWithdrawn} size="sm" />
            </Td>
            <Td>
              <Amount value={row.totalAvailableBalance} size="sm" />
            </Td>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SubPartnerTable({ rows }: { rows: SubPartnerReportRow[] }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <Th className="!text-left">Sub-partner</Th>
          <Th className="!text-left">Project</Th>
          <Th>Share %</Th>
          <Th>Money Added</Th>
          <Th>Money Withdrawn</Th>
          <Th>Available Balance</Th>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.subPartnerId}>
            <Td className="!text-left">{row.name}</Td>
            <Td className="!text-left">{row.projectName}</Td>
            <Td>{formatSharePercent(row.sharePercent)}%</Td>
            <Td>
              <Amount value={row.totalAdded} size="sm" />
            </Td>
            <Td>
              <Amount value={row.totalWithdrawn} size="sm" />
            </Td>
            <Td>
              <Amount value={row.totalAvailableBalance} size="sm" />
            </Td>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AvailableBalanceTable({ rows }: { rows: AvailableBalanceReportRow[] }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <Th className="!text-left">Name</Th>
          <Th className="!text-left">Project</Th>
          <Th>Balance</Th>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.partyType}:${row.shareId}:${row.projectId}`}>
            <Td className="!text-left">{row.name}</Td>
            <Td className="!text-left">{row.projectName}</Td>
            <Td>
              <Amount value={row.balance} size="sm" />
            </Td>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Picks the right table shape for `slug`'s own row type (this story's Code Map leaves exact column layout to the implementer -- see this story's Implementation Notes). Every entry-based slug except `"payment-mode"` shares `EntryRowsTable` -- `"payment-mode"` alone reshapes `assembleMoneyHistory()`'s output into `PaymentModeReportRow`s (Decision #3). */
function ReportTable({ slug, rows }: { slug: string; rows: ReportRow[] }) {
  switch (slug) {
    case "payment-mode":
      return <PaymentModeTable rows={rows as PaymentModeReportRow[]} />;
    case "project-money":
      return <ProjectMoneyTable rows={rows as ProjectMoneyReportRow[]} />;
    case "partner":
      return <PartnerTable rows={rows as PartnerReportRow[]} />;
    case "sub-partner":
      return <SubPartnerTable rows={rows as SubPartnerReportRow[]} />;
    case "available-balance":
      return <AvailableBalanceTable rows={rows as AvailableBalanceReportRow[]} />;
    default:
      return <EntryRowsTable rows={rows as MoneyHistoryEntry[]} />;
  }
}

/**
 * Report Viewer (Story 5.7, FR38/FR39) -- filter controls + a table of
 * rows, fetching `GET /api/reports/[type]` on mount and on filter change
 * (Decision #6). `"use client"` against a REST API, mirroring
 * `money-history/page.tsx`'s own established shape (not the Epic 5
 * dashboard server-component shape) -- Reports needs live filter
 * interaction that shape doesn't support.
 *
 * `report-catalog.tsx`'s own `getReportDefinition()` supplies the title,
 * description, and whether this report type supports the date-range filter
 * (Decision #8: the 4 aggregate types don't). An unrecognized slug (a
 * hand-typed URL, since every reachable link already comes from a granted
 * tile) still renders this same page shell -- the underlying `GET
 * /api/reports/[type]` call 404s, surfaced through the same error-state
 * branch every other fetch failure uses, rather than a bespoke "not found"
 * screen.
 */
export default function ReportViewerPage() {
  const params = useParams<{ type: string }>();
  const slug = params.type;
  const definition = getReportDefinition(slug);

  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [projects, setProjects] = useState<Project[]>([]);
  const [formFilters, setFormFilters] = useState<FilterFormState>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FilterFormState>(EMPTY_FILTERS);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((result) => {
        if (!cancelled) setProjects(result);
      })
      .catch(() => {
        // Best-effort only -- a failed fetch just means the Project filter's
        // <select> has no options beyond "All Projects"; the report itself
        // still loads independently below.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh(filters: FilterFormState) {
    setState({ status: "loading" });
    try {
      const query: ReportFiltersInput = {
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        projectId: filters.projectId || undefined,
        personName: filters.personName || undefined,
      };
      const result = await getReport(slug as ReportSlug, query);
      setState({ status: "loaded", rows: result.rows });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }

  useEffect(() => {
    // Nested inside an async IIFE -- `react-hooks/set-state-in-effect`
    // flags a direct call to `refresh` (whose body sets state) as if it
    // happened synchronously in the effect, mirroring
    // `money-history/page.tsx`'s identical `refresh`/`appliedFilters`
    // precedent.
    void (async () => {
      await refresh(appliedFilters);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `refresh` is stable across renders (only reads `slug`/its own argument); re-running on `appliedFilters`/`slug` is enough.
  }, [appliedFilters, slug]);

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters(formFilters);
  }

  function handleClearFilters() {
    setFormFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  }

  // Story 5.8 (FR40): export always operates on the CURRENTLY loaded,
  // CURRENTLY filtered `state.rows` -- never a fresh fetch, never an
  // unfiltered one (spec-5-8 Decisions #1/#8). Disabled whenever nothing is
  // loaded/loaded-but-empty (spec-5-8's I/O matrix) -- exporting nothing is
  // not a valid action.
  const canExport = state.status === "loaded" && state.rows.length > 0;

  function handleExportExcel() {
    if (state.status !== "loaded" || state.rows.length === 0) return;
    void exportReportToExcel(slug as ReportSlug, state.rows);
  }

  function handleExportPdf() {
    if (state.status !== "loaded" || state.rows.length === 0) return;
    void exportReportToPdf(slug as ReportSlug, state.rows);
  }

  const title = definition?.name ?? "Report";
  const description = definition?.description ?? "";
  const supportsDateFilter = definition?.supportsDateFilter ?? false;

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        action={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/*
                A raw `<button>`, not the shared `Button` component --
                mirrors `ProjectSwitcher.tsx`'s own established precedent
                for composing a Radix `DropdownMenuTrigger asChild` child
                (this codebase's only other `DropdownMenu` usage so far):
                `Button` is a plain function component with no
                `forwardRef`, and Radix's `Slot`-based `asChild` cloning
                needs a ref-forwarding host element. Reuses the exact same
                `nb-btn`/`nb-btn-ghost` CSS classes `Button`'s ghost variant
                itself emits (`packages/ui/src/styles/tokens.css`), so this
                stays pixel-consistent with every other ghost button rather
                than inventing new styling.
              */}
              <button
                type="button"
                disabled={!canExport}
                // `nb-btn-tone-accent` matches `Button tone="accent"`'s own
                // emitted class exactly (Decision 1's default-action tone,
                // founder feedback 2026-09-26) -- kept in lockstep with the
                // shared classes this raw button already reuses.
                className="nb-btn nb-btn-ghost nb-btn-tone-accent inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Export
                <ChevronDown size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={handleExportExcel}>Export as Excel</DropdownMenuItem>
              <DropdownMenuItem onSelect={handleExportPdf}>Export as PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <Card className="mb-5">
        <form onSubmit={handleFilterSubmit} className="flex flex-wrap items-end gap-3.5">
          {supportsDateFilter ? (
            <>
              <Field className="mb-0 min-w-[140px]">
                <Label htmlFor="rp-date-from">From</Label>
                <Input
                  id="rp-date-from"
                  type="date"
                  value={formFilters.dateFrom}
                  onChange={(event) => setFormFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
                />
              </Field>
              <Field className="mb-0 min-w-[140px]">
                <Label htmlFor="rp-date-to">To</Label>
                <Input
                  id="rp-date-to"
                  type="date"
                  value={formFilters.dateTo}
                  onChange={(event) => setFormFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
                />
              </Field>
            </>
          ) : null}
          <Field className="mb-0 min-w-[180px]">
            <Label htmlFor="rp-project">Project</Label>
            <select
              id="rp-project"
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
            <Label htmlFor="rp-person">Person</Label>
            <Input
              id="rp-person"
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
          <p className="text-[13.4px] text-ink-soft">Loading {title}…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.rows.length === 0 ? (
          <EmptyState
            icon={definition?.icon ?? <Search size={22} />}
            title={`No ${title} data yet`}
            description="Once there's matching activity, it'll show up here."
          />
        ) : (
          <ReportTable slug={slug} rows={state.rows} />
        )}
      </Card>
    </div>
  );
}
