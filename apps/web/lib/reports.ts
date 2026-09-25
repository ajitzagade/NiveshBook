import type { MoneyHistoryEntry } from "@niveshbook/types";
import type {
  AvailableBalanceReportRow,
  PartnerReportRow,
  PaymentModeReportRow,
  ProjectMoneyReportRow,
  SubPartnerReportRow,
} from "@niveshbook/core";
import type { ReportSlug } from "./report-catalog";

/**
 * Thin client-side fetch helper for `GET /api/reports/[type]` (Story 5.7,
 * FR38/FR39) -- mirrors `apps/web/lib/money-history.ts`'s identical
 * pattern. Every field type-only imported from `@niveshbook/core` -- this
 * file itself has no runtime `@niveshbook/core` import, so it's safe for
 * `reports/[type]/page.tsx`'s `"use client"` bundle (this codebase's
 * documented client-bundle gotcha, AGENTS.md).
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface ReportFiltersInput {
  dateFrom?: string;
  dateTo?: string;
  projectId?: string;
  personName?: string;
}

/** The union of every possible row shape `GET /api/reports/[type]` can return -- which member applies depends on the `type` requested (`report-catalog.tsx`'s own definitions), not encoded in this type itself. Callers narrow via the `type` they passed. */
export type ReportRow =
  | MoneyHistoryEntry
  | PaymentModeReportRow
  | ProjectMoneyReportRow
  | PartnerReportRow
  | SubPartnerReportRow
  | AvailableBalanceReportRow;

export interface ReportResponse<T> {
  rows: T[];
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
  } catch {
    // Body wasn't JSON (or had no message) -- fall through to the generic one.
  }
  return GENERIC_ERROR_MESSAGE;
}

/** Fetches one report type's rows, scoped/filtered server-side. Every filter field is optional -- an omitted/empty one is left off the query string entirely. Throws on a non-2xx response (401/403/404/etc) -- callers render the message. */
export async function getReport<T extends ReportRow = ReportRow>(
  type: ReportSlug,
  filters: ReportFiltersInput = {},
): Promise<ReportResponse<T>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "string" && value.trim().length > 0) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  const response = await fetch(`/api/reports/${type}${query ? `?${query}` : ""}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as ReportResponse<T>;
}
