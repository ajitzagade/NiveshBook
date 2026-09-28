"use client";

import { cloneElement, isValidElement, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Plus, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Input } from "./input";
import { cn } from "../lib/cn";

/**
 * spec-quick-add-project-user-modals: the reusable searchable-Combobox-
 * with-inline-create primitive (Design Notes) -- a plain filtered list
 * inside `Popover`/`PopoverContent`, never a new `cmdk`/Radix-Select
 * dependency. One selectable row.
 */
export interface ComboboxOption {
  id: string;
  label: string;
}

/**
 * The trailing "+ Add New X" row's own contract -- `renderForm` gets back
 * `onCancel` (collapse back to the list, no side effect) and `onCreated`
 * (the caller's inline form succeeded; `Combobox` treats the new option as
 * selected and closes, exactly like picking an existing row).
 */
export interface ComboboxAddNewSlot {
  label: string;
  renderForm: (args: {
    onCancel: () => void;
    onCreated: (option: ComboboxOption) => void;
  }) => ReactNode;
}

/**
 * Case-insensitive substring filter over `options` by `label` -- the
 * client-side search this spec's I/O matrix names ("Typing in either
 * Combobox: Client-side filter over fetched project list by name"). A pure
 * function (no hooks) so it's unit-testable with no DOM/React render at all,
 * mirroring this package's existing pure-helper convention
 * (`lib/format-amount.ts`).
 */
export function filterComboboxOptions(
  options: readonly ComboboxOption[],
  query: string,
): ComboboxOption[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return [...options];
  }
  return options.filter((option) => option.label.toLowerCase().includes(trimmed));
}

/**
 * The filtered-list + trailing add-new-row presentation -- a plain function
 * component with no hooks of its own (the stateful `Combobox` below owns
 * every piece of state: open/search/adding/highlight), so it can be
 * unit-tested by calling it directly and inspecting the returned element
 * tree, mirroring `dropdown-menu.tsx`/`popover.tsx`'s identical "plain
 * function, no jsdom needed" convention already established in this
 * package -- `Combobox` itself is the first component here whose parent
 * needs real interactive state, so splitting the pure list rendering out
 * keeps at least this piece testable without adding a jsdom/testing-library
 * devDependency to `packages/ui` (the interactive composition is covered
 * transitively by `apps/web`'s own jsdom-backed `ProjectSwitcher.test.tsx`
 * and equivalent).
 *
 * "No matches -> only + Add New Project shown" (this spec's I/O matrix): the
 * empty-state message only renders when there's no `addNew` slot to fall
 * back to -- with one, an empty filtered list still ends in a usable action
 * (create it) rather than a dead-end message sitting above it. When a
 * non-empty `searchQuery` produced that empty filtered list, a small
 * "No matches for…" line still renders above the add-new row so it's clear
 * the search (not an empty Project list) is why nothing else showed up --
 * optional and additive, so a caller/test that omits `searchQuery` keeps the
 * exact prior "just the add-new row" shape.
 *
 * `listboxId`/`activeOptionId` are optional, additive plumbing for
 * `role="listbox"`/`aria-activedescendant` (the standard ARIA 1.2 combobox
 * pattern -- focus stays on the search `Input`, which points at the
 * currently arrow-key-highlighted row by id, rather than moving DOM focus
 * into each option). Omitting them (as the unit tests below do) still
 * renders a fully clickable, valid list -- they only add the wiring
 * `Combobox` needs for keyboard navigation.
 */
export function ComboboxList({
  options,
  value,
  onSelect,
  emptyMessage,
  addNew,
  onStartAdd,
  searchQuery,
  listboxId,
  highlightedId,
}: {
  options: readonly ComboboxOption[];
  value: string | null;
  onSelect: (id: string) => void;
  emptyMessage: string;
  addNew?: ComboboxAddNewSlot;
  onStartAdd: () => void;
  searchQuery?: string;
  listboxId?: string;
  highlightedId?: string | null;
}) {
  const addNewId = listboxId ? `${listboxId}-add-new` : undefined;
  const noMatches = options.length === 0 && Boolean(searchQuery?.trim());
  return (
    <div className="flex flex-col">
      <div
        className="max-h-[220px] overflow-y-auto"
        role="listbox"
        id={listboxId}
      >
        {options.length === 0 && !addNew ? (
          <p className="px-2.5 py-1.5 text-[12.6px] text-ink-faint">{emptyMessage}</p>
        ) : options.length === 0 && noMatches ? (
          <p className="px-2.5 py-1.5 text-[12.6px] text-ink-faint">
            No matches for &ldquo;{searchQuery?.trim()}&rdquo;.
          </p>
        ) : (
          options.map((option) => {
            const optionId = listboxId ? `${listboxId}-option-${option.id}` : undefined;
            return (
              <button
                key={option.id}
                id={optionId}
                type="button"
                role="option"
                onClick={() => onSelect(option.id)}
                aria-selected={option.id === value}
                className={cn(
                  "block w-full cursor-pointer rounded-[6px] px-2.5 py-1.5 text-left text-[13px] text-ink outline-none hover:bg-surface-alt",
                  option.id === value && "bg-surface-alt font-semibold",
                  option.id === highlightedId && "bg-surface-alt",
                )}
              >
                {option.label}
              </button>
            );
          })
        )}
      </div>
      {addNew ? (
        <button
          type="button"
          id={addNewId}
          onClick={onStartAdd}
          className={cn(
            "mt-1 flex w-full items-center gap-1.5 rounded-[6px] border-t border-border px-2.5 py-1.5 pt-2 text-left text-[13px] font-semibold text-accent outline-none hover:bg-surface-alt",
            highlightedId === ADD_NEW_HIGHLIGHT_ID && "bg-surface-alt",
          )}
        >
          <Plus size={13} />
          {addNew.label}
        </button>
      ) : null}
    </div>
  );
}

/** Sentinel `highlightedId` value meaning "the + Add New row itself is highlighted" -- never a real `ComboboxOption["id"]` (those come from Project/User records), so it can't collide. */
const ADD_NEW_HIGHLIGHT_ID = "__combobox_add_new__";

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  value: string | null;
  onChange: (id: string) => void;
  /** The Popover's own trigger content -- fully caller-styled. Cloned internally to add `role="combobox"`/`aria-expanded`/`aria-haspopup` (a single React element is expected, mirroring `DropdownMenuTrigger`'s existing `asChild` contract). */
  trigger: ReactNode;
  /** Extra content pinned above the search input, never filtered by search (e.g. `ProjectSwitcher`'s fixed "All Investments" action row). */
  header?: ReactNode;
  emptyMessage?: string;
  searchPlaceholder?: string;
  /** Gated by the caller (e.g. `role === "owner_admin"`) -- omit entirely rather than pass a disabled slot, so a non-owner_admin session never sees the option (this spec's "never show what would 403 on submit" rule). */
  addNew?: ComboboxAddNewSlot;
  align?: "start" | "end";
  contentClassName?: string;
}

/**
 * The stateful Popover+Input+filtered-list shell (Design Notes) -- owns
 * open/search/adding/highlight state so every caller (`ProjectSwitcher`,
 * Money History's Project filter) just supplies `options`/`value`/`onChange`
 * plus an optional gated `addNew` slot, never re-implementing the popover/
 * search/inline-form/keyboard wiring per surface (AGENTS.md's UI-reuse
 * rule).
 *
 * Resets `search`/`adding`/`highlightedIndex` on close so the next open
 * always starts from the full, unfiltered list -- also what satisfies this
 * spec's "the Combobox opens with a project already selected, then that
 * project always appears in the list" acceptance criterion (an empty search
 * matches everything).
 *
 * Keyboard: ArrowDown/ArrowUp move a highlighted row (wrapping across the
 * filtered options plus the add-new row, when present); Home/End jump to
 * the first/last; Enter activates whichever is highlighted (selects a
 * Project, or opens the inline add-new form); Escape backs out of the
 * inline add-new form first (if open) rather than dismissing the whole
 * popover in one step, matching the ARIA 1.2 combobox pattern where focus
 * stays on the search `Input` throughout (`aria-activedescendant` on it
 * points at the highlighted row's id) instead of moving into each option.
 */
export function Combobox({
  options,
  value,
  onChange,
  trigger,
  header,
  emptyMessage = "No results.",
  searchPlaceholder = "Search…",
  addNew,
  align = "start",
  contentClassName,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listboxId = useId();

  const filtered = useMemo(() => filterComboboxOptions(options, search), [options, search]);
  const rowCount = filtered.length + (addNew ? 1 : 0);
  const clampedIndex = rowCount === 0 ? -1 : Math.min(highlightedIndex, rowCount - 1);
  const highlightedId =
    clampedIndex < 0 ? null : clampedIndex < filtered.length ? filtered[clampedIndex]!.id : ADD_NEW_HIGHLIGHT_ID;
  const activeOptionId =
    highlightedId === null
      ? undefined
      : highlightedId === ADD_NEW_HIGHLIGHT_ID
        ? `${listboxId}-add-new`
        : `${listboxId}-option-${highlightedId}`;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset transient state so the next open starts fresh -- otherwise a
      // stale search term could hide the currently-selected option, or the
      // popover could reopen straight into the inline add-new form.
      setSearch("");
      setAdding(false);
      setHighlightedIndex(0);
    }
  }

  function handleSelect(id: string) {
    onChange(id);
    handleOpenChange(false);
  }

  function handleCreated(option: ComboboxOption) {
    onChange(option.id);
    handleOpenChange(false);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (rowCount === 0) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlightedIndex((current) => (current + 1) % rowCount);
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlightedIndex((current) => (current - 1 + rowCount) % rowCount);
        break;
      case "Home":
        event.preventDefault();
        setHighlightedIndex(0);
        break;
      case "End":
        event.preventDefault();
        setHighlightedIndex(rowCount - 1);
        break;
      case "Enter":
        if (highlightedId === null) break;
        event.preventDefault();
        if (highlightedId === ADD_NEW_HIGHLIGHT_ID) {
          setAdding(true);
        } else {
          handleSelect(highlightedId);
        }
        break;
      default:
        break;
    }
  }

  // Deliberately leaves the trigger's own role alone (it's almost always a
  // native `<button>`, per every current caller) -- `role="combobox"` would
  // override that implicit "button" role in the accessibility tree, which
  // would also silently break every existing `getByRole("button", ...)`
  // query across this package's consumers. `aria-haspopup`/`aria-expanded`/
  // `aria-controls` on a plain button that opens a popup listbox is itself
  // a valid, well-understood pattern (mirrors `DropdownMenuTrigger`'s own
  // implicit contract) without that cost.
  const clonedTrigger = isValidElement(trigger)
    ? cloneElement(trigger, {
        "aria-haspopup": "listbox",
        "aria-expanded": open,
        "aria-controls": listboxId,
      } as Record<string, unknown>)
    : trigger;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{clonedTrigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn("w-[240px] p-2", contentClassName)}
        // While the inline add-new form is open, Escape backs out to the
        // list instead of Radix's default "dismiss the whole popover" --
        // otherwise a user who's typed a name and hits Escape reflexively
        // loses that unsaved input in the same step that would just close
        // a plain list.
        onEscapeKeyDown={(event) => {
          if (adding) {
            event.preventDefault();
            setAdding(false);
          }
        }}
      >
        {adding && addNew ? (
          addNew.renderForm({ onCancel: () => setAdding(false), onCreated: handleCreated })
        ) : (
          <>
            {header}
            <div className="relative mb-1.5">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <Input
                autoFocus
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setHighlightedIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                aria-autocomplete="list"
                aria-controls={listboxId}
                aria-activedescendant={activeOptionId}
                className="py-1.5 pl-7 text-[13px]"
              />
            </div>
            <ComboboxList
              options={filtered}
              value={value}
              onSelect={handleSelect}
              emptyMessage={emptyMessage}
              addNew={addNew}
              onStartAdd={() => setAdding(true)}
              searchQuery={search}
              listboxId={listboxId}
              highlightedId={highlightedId}
            />
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
