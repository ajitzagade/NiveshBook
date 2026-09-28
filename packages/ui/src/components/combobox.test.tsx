import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { ComboboxList, filterComboboxOptions, type ComboboxOption } from "./combobox";

const OPTIONS: ComboboxOption[] = [
  { id: "p1", label: "Alpha Tower" },
  { id: "p2", label: "Beta Residency" },
  { id: "p3", label: "Gamma Farms" },
];

describe("filterComboboxOptions (spec-quick-add-project-user-modals)", () => {
  it("returns every option, unfiltered, for an empty/whitespace-only query", () => {
    expect(filterComboboxOptions(OPTIONS, "")).toEqual(OPTIONS);
    expect(filterComboboxOptions(OPTIONS, "   ")).toEqual(OPTIONS);
  });

  it("filters by a case-insensitive substring match on label", () => {
    expect(filterComboboxOptions(OPTIONS, "beta")).toEqual([OPTIONS[1]]);
    expect(filterComboboxOptions(OPTIONS, "TOWER")).toEqual([OPTIONS[0]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterComboboxOptions(OPTIONS, "zzz")).toEqual([]);
  });

  it("never mutates the input array (returns a fresh copy on the empty-query path)", () => {
    const result = filterComboboxOptions(OPTIONS, "");
    expect(result).not.toBe(OPTIONS);
  });
});

/**
 * `ComboboxList` is a plain function component with no hooks of its own --
 * calling it directly and inspecting the returned element tree needs no DOM,
 * mirroring `dropdown-menu.test.tsx`/`popover.test.tsx`'s established
 * pattern in this package (the stateful `Combobox` shell itself is covered
 * transitively by `apps/web`'s jsdom-backed `ProjectSwitcher.test.tsx`).
 */
function childrenOf(element: ReactElement): ReactElement[] {
  const children = (element.props as { children: ReactElement | ReactElement[] }).children;
  return (Array.isArray(children) ? children : [children]) as ReactElement[];
}

describe("ComboboxList rendering (spec-quick-add-project-user-modals)", () => {
  it("renders one row per option, in order", () => {
    const tree = ComboboxList({
      options: OPTIONS,
      value: null,
      onSelect: vi.fn(),
      emptyMessage: "No results.",
      onStartAdd: vi.fn(),
    });
    const [listWrapper] = childrenOf(tree);
    const rows = childrenOf(listWrapper);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => (row.props as { children: string }).children)).toEqual([
      "Alpha Tower",
      "Beta Residency",
      "Gamma Farms",
    ]);
  });

  it("marks the row matching `value` as selected", () => {
    const tree = ComboboxList({
      options: OPTIONS,
      value: "p2",
      onSelect: vi.fn(),
      emptyMessage: "No results.",
      onStartAdd: vi.fn(),
    });
    const [listWrapper] = childrenOf(tree);
    const rows = childrenOf(listWrapper);
    expect((rows[0]?.props as { "aria-selected": boolean })["aria-selected"]).toBe(false);
    expect((rows[1]?.props as { "aria-selected": boolean })["aria-selected"]).toBe(true);
  });

  it("empty options, no addNew slot -> shows the empty message, no add-new row", () => {
    const tree = ComboboxList({
      options: [],
      value: null,
      onSelect: vi.fn(),
      emptyMessage: "No Projects yet.",
      onStartAdd: vi.fn(),
    });
    const [listWrapper, addNewRow] = childrenOf(tree);
    const emptyMessageEl = childrenOf(listWrapper)[0] as ReactElement;
    expect((emptyMessageEl.props as { children: string }).children).toBe("No Projects yet.");
    expect(addNewRow).toBeNull();
  });

  it("empty options WITH an addNew slot -> only the + Add New row shows, no dead-end empty message (this spec's I/O matrix)", () => {
    const tree = ComboboxList({
      options: [],
      value: null,
      onSelect: vi.fn(),
      emptyMessage: "No Projects yet.",
      addNew: { label: "+ Add New Project", renderForm: () => null },
      onStartAdd: vi.fn(),
    });
    const [listWrapper, addNewRow] = childrenOf(tree);
    // No rows and no empty-message paragraph inside the list wrapper.
    expect(childrenOf(listWrapper)).toEqual([]);
    expect(addNewRow).not.toBeNull();
  });

  it("non-empty options WITH an addNew slot -> both the rows and the + Add New row render", () => {
    const tree = ComboboxList({
      options: OPTIONS,
      value: null,
      onSelect: vi.fn(),
      emptyMessage: "No results.",
      addNew: { label: "+ Add New Project", renderForm: () => null },
      onStartAdd: vi.fn(),
    });
    const [listWrapper, addNewRow] = childrenOf(tree);
    expect(childrenOf(listWrapper)).toHaveLength(3);
    expect(addNewRow).not.toBeNull();
    expect(childrenOf(addNewRow as ReactElement).at(-1)).toBe("+ Add New Project");
  });

  it("no addNew slot -> never renders the add-new row, regardless of options", () => {
    const tree = ComboboxList({
      options: OPTIONS,
      value: null,
      onSelect: vi.fn(),
      emptyMessage: "No results.",
      onStartAdd: vi.fn(),
    });
    const [, addNewRow] = childrenOf(tree);
    expect(addNewRow).toBeNull();
  });

  it("clicking a row calls onSelect with that option's id", () => {
    const onSelect = vi.fn();
    const tree = ComboboxList({
      options: OPTIONS,
      value: null,
      onSelect,
      emptyMessage: "No results.",
      onStartAdd: vi.fn(),
    });
    const [listWrapper] = childrenOf(tree);
    const rows = childrenOf(listWrapper);
    (rows[1]?.props as { onClick: () => void }).onClick();
    expect(onSelect).toHaveBeenCalledWith("p2");
  });

  it("clicking the + Add New row calls onStartAdd", () => {
    const onStartAdd = vi.fn();
    const tree = ComboboxList({
      options: OPTIONS,
      value: null,
      onSelect: vi.fn(),
      emptyMessage: "No results.",
      addNew: { label: "+ Add New Project", renderForm: () => null },
      onStartAdd,
    });
    const [, addNewRow] = childrenOf(tree);
    ((addNewRow as ReactElement).props as { onClick: () => void }).onClick();
    expect(onStartAdd).toHaveBeenCalledTimes(1);
  });

  /**
   * Review-triage fix (spec-quick-add-project-user-modals, blind-hunter):
   * each row is now `role="option"` (valid ARIA alongside its existing
   * `aria-selected`, unlike a bare `<button>`) inside a `role="listbox"`
   * wrapper -- matching the standard ARIA 1.2 combobox pattern the plain
   * `<select>`/Radix `DropdownMenu` this component replaced already gave
   * screen-reader users for free.
   */
  it("the list wrapper is role=listbox and every row is role=option", () => {
    const tree = ComboboxList({
      options: OPTIONS,
      value: "p2",
      onSelect: vi.fn(),
      emptyMessage: "No results.",
      onStartAdd: vi.fn(),
    });
    const [listWrapper] = childrenOf(tree);
    expect((listWrapper.props as { role: string }).role).toBe("listbox");
    const rows = childrenOf(listWrapper);
    for (const row of rows) {
      expect((row.props as { role: string }).role).toBe("option");
    }
  });

  /**
   * Review-triage fix: a non-empty `searchQuery` that matches nothing (with
   * an `addNew` slot present) now says so explicitly, instead of leaving it
   * ambiguous whether the whole Project list is empty or the search just
   * didn't match (this spec's I/O matrix: "No matches -> only + Add New
   * Project shown" -- the add-new row still must be the only *actionable*
   * row, so this message is additive, not a replacement).
   */
  it("a non-matching search with an addNew slot shows a 'No matches for …' message alongside the + Add New row", () => {
    const tree = ComboboxList({
      options: [],
      value: null,
      onSelect: vi.fn(),
      emptyMessage: "No Projects yet.",
      addNew: { label: "+ Add New Project", renderForm: () => null },
      onStartAdd: vi.fn(),
      searchQuery: "zzz",
    });
    const [listWrapper, addNewRow] = childrenOf(tree);
    const message = childrenOf(listWrapper)[0] as ReactElement;
    expect((message.props as { children: unknown[] }).children.join("")).toContain("zzz");
    expect(addNewRow).not.toBeNull();
  });

  it("an empty (not non-matching) search with an addNew slot keeps the prior no-message shape", () => {
    const tree = ComboboxList({
      options: [],
      value: null,
      onSelect: vi.fn(),
      emptyMessage: "No Projects yet.",
      addNew: { label: "+ Add New Project", renderForm: () => null },
      onStartAdd: vi.fn(),
      searchQuery: "",
    });
    const [listWrapper] = childrenOf(tree);
    expect(childrenOf(listWrapper)).toEqual([]);
  });
});
