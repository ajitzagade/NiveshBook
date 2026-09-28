"use client";

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Combobox, formatAmount, type ComboboxOption } from "@niveshbook/ui";
import type { InvestmentRequirement, Project } from "@niveshbook/types";
import { listInvestmentRequirements } from "@/lib/investment-requirements";
import { listPartnerShares } from "@/lib/partner-shares";
import { listSubPartnerShares } from "@/lib/subpartner-shares";
import { ProjectQuickAddForm } from "../ProjectQuickAddForm";

/**
 * A "project" destination's funding-requirement + Partner/Sub-partner Share
 * pickers (Story 4.8, FR28), plus the lazy-fetch-per-destination-Project
 * plumbing behind it -- extracted out of `withdraw-money/page.tsx` (Story
 * 4.9, FR29) into this shared module so the new Available Balance page's
 * "Invest in a Project" spend can reuse the exact same business logic
 * (destination-Project-change fetch, requirement/Share `<select>`s) instead
 * of forking a second copy (SOLID/DRY -- this story's Code Map, an app-level
 * extraction, not a `packages/ui` change: the component's business logic,
 * not its visuals, is what's shared). `withdraw-money/page.tsx`'s own
 * `AllocationLegRow`/`AllocationLegForm` -- everything else about that
 * dialog's shape -- stay exactly as they were, only importing from here
 * instead of defining these pieces locally.
 */

/** One selectable Partner/Sub-partner in a "project" destination's Share picker -- flattens the destination Project's current Partner Shares plus each Partner's current Sub-partner Shares into one list (a `<select>` has no nesting, so Sub-partner options use a label prefix instead). */
export interface DestinationShareOption {
  partyType: "partner" | "sub_partner";
  shareId: string;
  label: string;
}

/**
 * A destination Project's current funding requirements + Partner/Sub-partner
 * Share options -- fetched lazily, once per distinct destination Project id,
 * the first time a "project" destination's Project selector names it.
 * `"loaded"` with an empty `requirements` array is the "this Project has no
 * funding requirements yet" blocking case -- rendered inline next to the
 * Project selector by the caller.
 */
export type DestinationProjectDataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; requirements: InvestmentRequirement[]; shareOptions: DestinationShareOption[] };

/**
 * The subset of a "project" destination's editable form fields
 * `DestinationRequirementAndSharePickers` reads/writes -- deliberately
 * narrower than either caller's own full form-row shape (`AllocationLegForm`
 * in `withdraw-money/page.tsx`, the Available Balance page's own spend-form
 * state), which both structurally satisfy this interface (Interface
 * Segregation) since both carry these exact three fields among others.
 */
export interface DestinationSharePickerFields {
  destinationRequirementId: string;
  destinationShareId: string;
  destinationPartyType: "partner" | "sub_partner" | "";
}

/**
 * Fetches one destination Project's current funding requirements +
 * Partner/Sub-partner Shares (Story 4.8, FR28) -- Sub-partner Shares are
 * fetched per-Partner (`listSubPartnerShares`, the only endpoint that exists
 * for that resource -- there is no project-wide Sub-partner Shares listing),
 * fanned out in parallel once the Partner Shares list resolves. A pure
 * fetch, no state of its own -- `useDestinationProjectData` below owns the
 * state/caching.
 */
async function fetchDestinationProjectData(
  destinationProjectId: string,
): Promise<{ requirements: InvestmentRequirement[]; shareOptions: DestinationShareOption[] }> {
  const [requirementsResult, partnerSharesResult] = await Promise.all([
    listInvestmentRequirements(destinationProjectId),
    listPartnerShares(destinationProjectId),
  ]);
  const subPartnerResults = await Promise.all(
    partnerSharesResult.shares.map((partner) =>
      listSubPartnerShares(destinationProjectId, partner.partnerId).then((result) => ({
        partner,
        shares: result.shares,
      })),
    ),
  );
  const shareOptions: DestinationShareOption[] = [];
  for (const partner of partnerSharesResult.shares) {
    shareOptions.push({ partyType: "partner", shareId: partner.partnerId, label: partner.name });
  }
  for (const { partner, shares } of subPartnerResults) {
    for (const sub of shares) {
      shareOptions.push({
        partyType: "sub_partner",
        shareId: sub.subPartnerId,
        label: `↳ ${sub.name} (under ${partner.name})`,
      });
    }
  }
  return { requirements: requirementsResult.requirements, shareOptions };
}

/**
 * Owns the lazy-fetch-per-destination-Project state/caching behind
 * `DestinationRequirementAndSharePickers` -- extracted out of
 * `withdraw-money/page.tsx`'s own `destinationProjectData`/
 * `requestedDestinationProjectIdsRef`/`loadDestinationProjectData`/
 * `ensureDestinationProjectData` (Story 4.8) verbatim, as a reusable hook.
 * `ensureDestinationProjectData` kicks off `fetchDestinationProjectData` at
 * most once per destination Project id -- call it whenever a "project"
 * destination's Project selector changes.
 */
export function useDestinationProjectData(): {
  destinationProjectData: Record<string, DestinationProjectDataState>;
  ensureDestinationProjectData: (destinationProjectId: string) => void;
} {
  const [destinationProjectData, setDestinationProjectData] = useState<
    Record<string, DestinationProjectDataState>
  >({});
  // Tracks which destination Project ids have already had a fetch kicked off
  // -- a `ref` (not derived from `destinationProjectData` itself) so a fetch
  // started this render is never accidentally started a second time by a
  // same-render re-check before the first `setDestinationProjectData` call
  // has been applied.
  const requestedDestinationProjectIdsRef = useRef<Set<string>>(new Set());

  async function loadDestinationProjectData(destinationProjectId: string) {
    try {
      const { requirements, shareOptions } = await fetchDestinationProjectData(destinationProjectId);
      setDestinationProjectData((prev) => ({
        ...prev,
        [destinationProjectId]: { status: "loaded", requirements, shareOptions },
      }));
    } catch (error) {
      setDestinationProjectData((prev) => ({
        ...prev,
        [destinationProjectId]: {
          status: "error",
          message: error instanceof Error ? error.message : "Something went wrong.",
        },
      }));
    }
  }

  function ensureDestinationProjectData(destinationProjectId: string) {
    if (!destinationProjectId || requestedDestinationProjectIdsRef.current.has(destinationProjectId)) {
      return;
    }
    requestedDestinationProjectIdsRef.current.add(destinationProjectId);
    setDestinationProjectData((prev) => ({ ...prev, [destinationProjectId]: { status: "loading" } }));
    void loadDestinationProjectData(destinationProjectId);
  }

  return { destinationProjectData, ensureDestinationProjectData };
}

/**
 * A "project" destination's funding-requirement + Partner/Sub-partner Share
 * pickers (Story 4.8, FR28) -- rendered only once a destination Project is
 * chosen (the caller's own guard). Three states mirror
 * `DestinationProjectDataState`: `"loading"` (fetch in flight), `"error"`
 * (surfaced inline, `role="alert"`), `"loaded"` -- which itself splits into
 * the zero-requirements blocking case ("this Project has no funding
 * requirements yet") and the normal two-`<select>` case. The Share
 * `<select>`'s `value`/`onChange` encode `partyType`+`shareId` together as
 * one `"partner:<id>"`/`"sub_partner:<id>"` string -- the simplest way to
 * drive two form fields from one native `<select>` without a second,
 * redundant control.
 */
export function DestinationRequirementAndSharePickers({
  rowLabel,
  leg,
  projectName,
  data,
  onChange,
}: {
  rowLabel: string;
  leg: DestinationSharePickerFields;
  projectName: string;
  data: DestinationProjectDataState | undefined;
  onChange: (patch: Partial<DestinationSharePickerFields>) => void;
}) {
  if (!data || data.status === "loading") {
    return <p className="mt-2 text-[12.6px] text-ink-soft">Loading funding requirements…</p>;
  }
  if (data.status === "error") {
    return (
      <p role="alert" className="mt-2 text-[12.6px] text-danger">
        Couldn&apos;t load {projectName}&apos;s funding requirements: {data.message}
      </p>
    );
  }
  if (data.requirements.length === 0) {
    return (
      <p role="alert" className="mt-2 text-[12.6px] text-danger">
        {projectName} has no funding requirements yet -- choose a different destination.
      </p>
    );
  }
  // A destination Project can have a funding requirement but no current
  // Partner/Sub-partner Shares to attribute the moved money to (e.g. Shares
  // never set up yet) -- mirrors the zero-requirements block above; the
  // caller's own gate (an empty `destinationShareId`) keeps the action
  // disabled either way, this only adds the explanatory message.
  if (data.shareOptions.length === 0) {
    return (
      <p role="alert" className="mt-2 text-[12.6px] text-danger">
        {projectName} has no Partner/Sub-partner Shares yet -- choose a different destination.
      </p>
    );
  }

  const shareValue =
    leg.destinationPartyType && leg.destinationShareId
      ? `${leg.destinationPartyType}:${leg.destinationShareId}`
      : "";

  return (
    <>
      <div className="mt-2">
        <select
          aria-label={`Destination funding requirement (${rowLabel})`}
          className="w-full rounded-el border border-border bg-surface px-3 py-2.5 text-[14px] text-ink focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft"
          value={leg.destinationRequirementId}
          onChange={(event) => onChange({ destinationRequirementId: event.target.value })}
        >
          <option value="">Select a funding requirement…</option>
          {data.requirements.map((requirement) => (
            <option key={requirement.id} value={requirement.id}>
              {requirement.requirementDate} — {formatAmount(requirement.amount)}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2">
        <select
          aria-label={`Destination Partner/Sub-partner Share (${rowLabel})`}
          className="w-full rounded-el border border-border bg-surface px-3 py-2.5 text-[14px] text-ink focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft"
          value={shareValue}
          onChange={(event) => {
            const [partyType, shareId] = event.target.value.split(":") as
              | ["partner" | "sub_partner", string]
              | [""];
            onChange({
              destinationPartyType: partyType || "",
              destinationShareId: shareId ?? "",
            });
          }}
        >
          <option value="">Select a Partner/Sub-partner…</option>
          {data.shareOptions.map((option) => (
            <option key={`${option.partyType}:${option.shareId}`} value={`${option.partyType}:${option.shareId}`}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

/**
 * spec-quick-add-project-user-modals (follow-up): the "project" destination's
 * own Project picker -- shared between `withdraw-money/page.tsx`'s per-row
 * `AllocationLegRow` and the Available Balance page's single spend form, same
 * extraction rationale as everything else in this file. Wraps the shared
 * `Combobox` primitive (`packages/ui`) with a gated "+ Add New Project" row,
 * exactly mirroring `ProjectSwitcher`/`money-history/page.tsx`'s own pattern
 * -- these two destination-Project `<select>`s were the two surfaces
 * deferred from that spec (both already inside a `Dialog`; the Combobox's
 * `addNew` renders inline in its own `Popover`, never a second `Dialog`, and
 * `packages/ui`'s `DialogContent` now ignores outside-clicks that land
 * inside a Radix popper wrapper -- the fix landed in the sibling
 * quick-add-user-share-dialog spec -- so nesting it here is safe).
 *
 * `projectsLoaded` gates the quick-add row the same way `usersLoaded` does
 * on the Shares page: `GET /api/projects` (unlike `/api/my-projects`) is
 * `owner_admin`-only, so a successful fetch already proves the session may
 * also create one -- no separate role check needed.
 */
export function DestinationProjectPicker({
  id,
  ariaLabel,
  rowLabel,
  projectOptions,
  projectsLoaded,
  projectsError,
  value,
  onSelect,
  onProjectCreated,
  leg,
  data,
  onChange,
}: {
  /** Pairs with a visible `<Label htmlFor>` (Available Balance's own field shape) -- omit when using `ariaLabel` instead (withdraw-money's compact per-row shape, no visible label). */
  id?: string;
  ariaLabel?: string;
  /** Used both for `DestinationRequirementAndSharePickers`' own row-scoped aria-labels and for this picker's "no options" empty message. */
  rowLabel: string;
  projectOptions: Project[];
  projectsLoaded: boolean;
  projectsError: string | null;
  value: string;
  /** Fires on every selection change (manual pick or quick-add) -- the caller resets `destinationRequirementId`/`destinationShareId`/`destinationPartyType` and kicks off `ensureDestinationProjectData`, mirroring the native `<select>`'s own former `onChange` body exactly. */
  onSelect: (projectId: string) => void;
  /** The full created `Project` (not a slim `ComboboxOption`) -- the caller appends it straight into its own `projectsState.projects: Project[]`, no fabricated fields. */
  onProjectCreated: (project: Project) => void;
  leg: DestinationSharePickerFields;
  data: DestinationProjectDataState | undefined;
  onChange: (patch: Partial<DestinationSharePickerFields>) => void;
}) {
  return (
    <>
      <Combobox
        options={projectOptions.map((project): ComboboxOption => ({ id: project.id, label: project.name }))}
        value={value}
        onChange={onSelect}
        searchPlaceholder="Search Projects…"
        emptyMessage="No Projects yet."
        trigger={
          <button
            type="button"
            id={id}
            aria-label={ariaLabel}
            className="flex w-full items-center justify-between gap-2 rounded-el border border-border bg-surface px-3 py-2.5 text-left text-[14px] text-ink focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft"
          >
            <span className="truncate">
              {value ? projectOptions.find((project) => project.id === value)?.name ?? "Loading…" : "Select a Project…"}
            </span>
            <ChevronDown size={14} className="shrink-0 text-ink-faint" />
          </button>
        }
        addNew={
          projectsLoaded
            ? {
                label: "+ Add New Project",
                renderForm: ({ onCancel, onCreated }) => (
                  <ProjectQuickAddForm
                    compact
                    onCancel={onCancel}
                    onCreated={(project) => {
                      onProjectCreated(project);
                      onCreated({ id: project.id, label: project.name });
                    }}
                  />
                ),
              }
            : undefined
        }
      />
      {projectsError ? (
        <p role="alert" className="mt-1 text-[12.6px] text-danger">
          Couldn&apos;t load Projects: {projectsError}
        </p>
      ) : null}

      {value ? (
        <DestinationRequirementAndSharePickers
          rowLabel={rowLabel}
          leg={leg}
          projectName={projectOptions.find((project) => project.id === value)?.name ?? "This Project"}
          data={data}
          onChange={onChange}
        />
      ) : null}
    </>
  );
}
