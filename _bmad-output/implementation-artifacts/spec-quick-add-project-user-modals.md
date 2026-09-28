---
title: 'Quick-Add Project in Selection Dropdowns'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'e550da27b2e458c71c0c72d3b9251e6ca5657559'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Creating a Project today requires leaving the current screen for a full `/projects/new` page, breaking flow whenever a user just needs to pick a project and realizes it doesn't exist yet (sidebar switcher, Money History's project filter).

**Approach:** Add one reusable searchable-Combobox-with-inline-create primitive to `packages/ui`, then apply it to the two Project-selection surfaces that are not already nested inside another dialog: the sidebar `ProjectSwitcher` and Money History's project filter. Each gets a "+ Add New Project" row that opens a create-project mini-form and auto-selects the result on success. Reuses `createProject` (`packages/core`) and `POST /api/projects` unchanged — no new business logic.

## Boundaries & Constraints

**Always:**
- Reuse `createProject` (`packages/core`) and the existing `POST /api/projects` route as-is — zero new business logic, zero schema changes.
- The "+ Add New Project" row only renders when the current session passes the existing `projects:create` gate (`owner_admin`-only today, `authorize.ts:112`). Never show the option to a session that would 403 on submit.
- Build the Combobox from existing `packages/ui` primitives (`Popover`, `Input`) — no new npm dependency.
- Match `apps/web/app/(dashboard)/projects/new/page.tsx`'s existing field set exactly (`name` required, `description` optional) — Partner Shares stay a later, separate step, same as today.

**Never:**
- Do not touch the Partner/Sub-partner Share dialog's "Linked user" field or the withdraw-money/available-balance destination-Project pickers — already inside a `Dialog`; EXPERIENCE.md bans a second stacked modal there. Tracked in `deferred-work.md`.
- Do not expand any `authorize.ts` permission scope.
- Do not add project-name uniqueness validation — none exists today.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Quick-add, owner_admin, either surface | "+ Add New Project", enters name | `createProject` called, list refetched, new project auto-selected (switcher: via `selectProject`; filter: as `formFilters.projectId`) | N/A |
| Quick-add, non-owner_admin | Either surface | "+ Add New Project" row absent | N/A |
| Blank name submitted | Quick-add form | Blocked client-side; if bypassed, `InvalidProjectNameError` shown inline, form stays open | Mirrors `projects/new` validation |
| Search | Typing in either Combobox | Client-side filter over fetched project list by name | No matches → only "+ Add New Project" shown |

</frozen-after-approval>

## Code Map

- `packages/ui/src/components/combobox.tsx` (new) -- Popover+Input searchable list; trailing "+ Add New X" row renders a caller-supplied inline form, no separate `Dialog`.
- `packages/ui/src/index.tsx` -- add `export * from "./components/combobox"`.
- `apps/web/app/(dashboard)/ProjectSwitcher.tsx:33-86` -- swap `DropdownMenu` for Combobox; `projects`/`activeProjectId`/`onSelect` unchanged; add gated quick-add row.
- `apps/web/app/(dashboard)/SidebarShell.tsx:41-155` -- owns `activeProjectId`, `selectProject`, `listMyProjects()` (:71-85); quick-add reuses `selectProject` after creation, then refetches.
- `apps/web/app/(dashboard)/money-history/page.tsx:403-415` -- swap native `<select id="mh-project">` for Combobox; same `formFilters.projectId` (:83) and `listMyProjects()` list (:178-192).
- `apps/web/app/(dashboard)/projects/new/page.tsx:22-68` -- existing `name`/`description` form; extract into shared `ProjectQuickAddForm` used here and in the Combobox.
- `apps/web/lib/projects.ts:78-88` -- `createProject()` client wrapper; reuse unchanged.
- `apps/web/app/api/projects/route.ts:97-148` + `packages/core/src/authorize.ts:112` -- `"projects:create"` gate, `owner_admin`-only; drives row visibility.
- `packages/core/src/project.ts:51-55` -- `createProject(input, deps)`; confirms no name-uniqueness check exists.

## Tasks & Acceptance

**Execution:**
- [x] `packages/ui/src/components/combobox.tsx` -- build Combobox (Popover + Input + filtered list + inline "add new" sub-form slot) -- single reusable primitive, AGENTS.md UI-reuse rule
- [x] `packages/ui/src/index.tsx` -- export it -- barrel consistency
- [x] `apps/web/app/(dashboard)/projects/new/page.tsx` -- extract `ProjectQuickAddForm` (name/description + `createProject()`) -- shared by this page and the Combobox
- [x] `apps/web/app/(dashboard)/ProjectSwitcher.tsx` -- Combobox + owner_admin-gated quick-add row, auto-select on success
- [x] `apps/web/app/(dashboard)/money-history/page.tsx` -- Combobox + same gated quick-add row on the filter
- [x] Unit tests: Combobox filtering, quick-add-then-auto-select on both surfaces, owner_admin-only visibility, empty/duplicate-name passthrough

**Acceptance Criteria:**
- Given an owner_admin session on either surface, when they choose "+ Add New Project" and submit a valid name, then the project is created, the list refreshes, and it becomes the selected value with no navigation to `/projects/new`.
- Given a partner/sub_partner session, when either Combobox opens, then no "+ Add New Project" row renders.
- Given a blank name, when submitted, then it's blocked client-side; if the API still rejects it, `InvalidProjectNameError`'s message shows inline without closing the form.
- Given the Combobox opens with a project already selected, then that project always appears in the list.

## Implementation Notes

Implemented as planned, with one path deviation: `ProjectQuickAddForm` landed at `apps/web/app/(dashboard)/projects/ProjectQuickAddForm.tsx` (co-located with `projects/new/page.tsx`, matching this repo's existing convention for page-adjacent shared components like `destination-picker.tsx`) rather than a new top-level `apps/web/components/` directory named in the Code Map at planning time — same component, same contract, just filed next to its origin page instead of introducing a new directory.

`PopoverClose` was added to `packages/ui/src/components/popover.tsx` (re-exporting Radix's own `Popover.Close`) so `ProjectSwitcher`'s fixed "All Investments" header row, passed into `Combobox`'s `header` slot, can close the popover on click the same way selecting a Project does — not anticipated in the original Code Map but a one-line addition consistent with the file's existing re-export pattern.

Correction to an earlier pass's note (superseded, before this fix): `apps/web/app/(dashboard)/money-history/page.test.tsx` already existed at HEAD (32 tests, committed in `e550da2`, covering Story 5.1/5.2/5.3/5.9 and the mobile RowCard stack) — an earlier `Write` call in this task overwrote it wholesale with only this spec's own new tests, silently discarding that pre-existing coverage (a real collision, not the "transient snapshot" kind AGENTS.md's Concurrency Note describes — confirmed via `git show HEAD:<path>`, not assumed). Fixed by reconstructing the merged file: every original test kept verbatim except the 6 spots that drove the Project filter via `userEvent.selectOptions()`/asserted `toHaveValue()` on the now-removed native `<select>` — those now open the Combobox and assert on its trigger's text content instead (the trigger's accessible *name* stays "Project", from the paired `<label for>`, unchanged from the `<select>`'s own accessible name) — plus this spec's own 6 new quick-add tests appended. No other file this task wrote showed a similar collision (checked via `git status`/`git log` against every path touched); the file's own `beforeEach` continues to default every session to `owner_admin` so none of the 32 pre-existing tests needed to know about the new role-gated row at all.

Full verification run (not just the implementing subagent's own report): `pnpm --filter @niveshbook/ui test` (91 tests) and `pnpm --filter web test` (1204 tests) both pass; `pnpm lint` clean (only pre-existing, unrelated `security/detect-object-injection` warnings in `packages/core`/`packages/db`); `pnpm typecheck` clean across all 6 packages; `pnpm build` succeeds, including the new `/projects/new` route render; `pnpm audit` reports zero vulnerabilities. All Tasks marked `[x]`; every I/O matrix row and all 4 Acceptance Criteria have a passing covering test across `combobox.test.tsx`, `ProjectQuickAddForm.test.tsx`, `ProjectSwitcher.test.tsx`, and `money-history/page.test.tsx` (the 4th criterion -- "the Combobox opens with a project already selected, then that project always appears in the list" -- got its own explicit test in `ProjectSwitcher.test.tsx`, added on a second pass since it wasn't yet directly asserted).

Nothing left incomplete within this spec's scope. The two surfaces explicitly deferred (Partner/Sub-partner Share dialog's user field, and the withdraw-money/available-balance destination-Project pickers) remain untouched, tracked in `deferred-work.md`. Residual risk: no automated visual/browser check was run against the real Popover positioning inside the Money History filter row and the sidebar (jsdom + Testing Library exercises the real component/DOM code paths but not actual layout/paint) — worth a quick manual look, per this spec's own Verification section's "Manual checks" fallback.

## Spec Change Log

## Review Triage Log

- **medium** — `packages/ui/src/components/combobox.tsx`: `Combobox`/`ComboboxList` regress accessibility versus what they replaced — no `role="combobox"`/`aria-expanded`/`aria-haspopup` on the trigger, no `role="listbox"`/`role="option"` (so `aria-selected` on a plain `<button>` is an invalid ARIA pairing), no Arrow/Home/End/typeahead keyboard navigation, and the search `Input` has no accessible name (placeholder only). Verified by reading the file: no `onKeyDown` handler exists anywhere in it, and `ComboboxList`'s rows are plain `<button>`s with `aria-selected` but no ancestor `role="listbox"`. The native `<select>` (Money History) and Radix `DropdownMenu` (sidebar) both gave this for free before. Keyboard users can still Tab+Enter through options, so it's degraded, not unusable. Route: patch.
- **medium** — `packages/ui/src/components/combobox.tsx` `handleCreated` + `apps/web/app/(dashboard)/projects/ProjectQuickAddForm.tsx` `handleSubmit`: if a user submits the quick-add form and dismisses the popover (outside click/Escape) before `createProject()` resolves, the in-flight promise still calls `onCreated` → `Combobox.handleCreated` → the caller's `onChange`, silently re-selecting/navigating to the new project after the user had already backed out. Verified by tracing: `ProjectQuickAddForm` has no unmount guard around its `await createProject(...)` continuation, and `onChange` is a plain prop call with no open-state check in `handleCreated`. Route: patch.
- **low** — `apps/web/app/(dashboard)/SidebarShell.tsx:148-156` and `apps/web/app/(dashboard)/money-history/page.tsx:234-244` (`handleProjectCreated`): the background `listMyProjects()` reconciliation fetch has no unmount-cancellation guard (unlike this same file's other effects, which all use a `cancelled` flag). Verified by reading both functions directly. Consequence is a React setState-after-unmount dev warning only — the actual selection already happened synchronously via `onChange` before this fires, so no user-visible incorrect state. Route: patch.
- **false** — edge-case-hunter's claim that `handleProjectCreated`'s `listMyProjects()` refetch could omit the just-created project (read-after-write lag) and make the optimistic entry "silently disappear," contradicting the spec's 4th acceptance criterion. Refuted: checked `packages/db`/`packages/core`/the `/api/my-projects` and `/api/projects` routes for any cache/replica layer — none exists; both the create-write and the immediately-following list-read go through the same single Postgres primary in the same request flow, which guarantees read-after-write visibility here. Not reachable in this architecture.
- **low** — `apps/web/app/(dashboard)/projects/ProjectQuickAddForm.tsx`: hardcoded DOM ids (`quick-add-project-name`, `quick-add-project-description`) instead of an instance-scoped id (`useId()`). Real but low-probability given Radix Popover closes/unmounts one popover's content on outside-interaction before another typically opens; still a correct, zero-downside fix. Route: patch.
- **low** — `apps/web/app/(dashboard)/ProjectSwitcher.tsx` and `apps/web/app/(dashboard)/money-history/page.tsx`: `role === "owner_admin"` is duplicated as a literal in both files to gate the quick-add row, instead of one shared helper mirroring `packages/core/src/authorize.ts:112`'s `"projects:create"` gate. Developer-facing risk: a future permission change now has two (soon more, per the deferred User quick-add work) UI call sites to keep in sync instead of one. Route: patch.
- **low** — `packages/ui/src/components/combobox.tsx` `ComboboxList`: when an `addNew` slot is present and a search matches nothing, only the "+ Add New Project" row shows with no "no results for '<query>'" message — ambiguous whether the whole list is empty or the search just didn't match. Route: patch.
- **false** — blind-hunter's concern that AGENTS.md's build-measurement rule (measure new `packages/ui` fixed-size values via computed style, not an eyeballed screenshot — precedent: a prior bug shipped a 14px badge/0px padding undetected for weeks) wasn't satisfied. Checked directly: grepped the built `apps/web/.next/static/chunks/*.css` output for every arbitrary-value class `combobox.tsx` introduces (`w-[240px]`, `max-h-[220px]`, `text-[13px]`, `text-[12.6px]`, `rounded-[6px]`, `py-1.5`, `pl-7`) — all present with correct values. The specific failure mode the AGENTS.md precedent describes (Tailwind's `@source` scan silently dropping a `packages/ui`-only class) does not occur here; there's also no external design-doc dimension for this brand-new component to diff a rendered value against (unlike the badge/padding precedent, which had a spec'd size to be wrong against).
- **low** — reject: `apps/web/app/(dashboard)/money-history/page.tsx`: if `getCurrentUser()` fails, `role` stays `null` for the page's lifetime with no retry, permanently hiding "+ Add New Project" for that session. Fails safe (hides a privileged action, doesn't expose one), and adding retry/backoff logic is more complexity than this rare, self-recovering-on-reload edge case warrants. Rejected per SCOPE STANDARD's low-severity/non-trivial-fix rule.
- **low** — reject (superseded, see note below): `packages/ui/src/components/combobox.tsx`: Escape while the inline add-new form has unsaved input discards the whole popover in one step (Radix's default dismiss), rather than backing out to the list first. Real but the fix (intercept `onEscapeKeyDown`, branch on `adding` state) is more than a direct correction, and the harm is just re-typing a name. Rejected per the same rule.

**Patches applied** (all `medium`/`low` entries above routed `patch`; the implementation subagent was unreachable for re-engagement mid-review, so these were applied directly per step-04's "if it cannot be continued, apply the patches yourself"):
- Combobox/ComboboxList: added `role="listbox"`/`role="option"`, `aria-haspopup`/`aria-expanded`/`aria-controls` on the trigger (via `cloneElement`, without overriding its native `role="button"` -- an earlier attempt that set `role="combobox"` broke every existing `getByRole("button", ...)` query across the test suite and was reverted), `aria-label`/`aria-autocomplete`/`aria-activedescendant` on the search `Input`, and Arrow/Home/End/Enter keyboard navigation with a highlighted-row state. Implementing this surfaced that my first pass at the Escape-backs-out-of-the-add-form fix was dead code (the search `Input` carrying that handler isn't even mounted while the add-form shows) -- moved it to `PopoverContent`'s own `onEscapeKeyDown` instead, which reaches the add-form correctly. That resolves the "reject" entry directly above as a side effect: no longer rejected, fixed for free once the real keyboard-nav plumbing existed to hang it on.
- `ComboboxList` also gains a "No matches for '<query>'" message (additive -- the empty-options-with-no-searchQuery shape used by every existing test is untouched).
- `ProjectQuickAddForm.tsx`: `useId()` replaces the two hardcoded ids; a `mountedRef` guard skips `onCreated`/`setError`/`setSubmitting` if `createProject()` resolves after unmount (closes the popover-dismiss race).
- `SidebarShell.tsx` and `money-history/page.tsx`: `handleProjectCreated`'s background `listMyProjects()` reconciliation now checks a `mountedRef` before `setProjects(result)`.
- `apps/web/lib/projects.ts`: added `canCreateProject(role)`, now the single place both files' quick-add gate calls into instead of a duplicated `role === "owner_admin"` literal.
- New/updated tests: `combobox.test.tsx` (role=listbox/option, no-matches message), `ProjectQuickAddForm.test.tsx` (useId uniqueness across two simultaneous instances, dismiss-before-resolve never calls `onCreated`), `ProjectSwitcher.test.tsx` (ArrowDown+Enter selects the highlighted Project; Escape backs out of the add-form without closing the popover). Every test file mocking `@/lib/projects` (`ProjectSwitcher.test.tsx`, `money-history/page.test.tsx`, `MobileNav.test.tsx`) updated to also export the new `canCreateProject` from its mock.
- Full verification after patches: `pnpm --filter @niveshbook/ui test` (94 tests), `pnpm --filter web test` (1208 tests, run twice to confirm no flakiness), `pnpm lint` (clean; one new warning at `combobox.tsx:226` is the same `security/detect-object-injection` false-positive-on-array-index pattern already tolerated throughout `packages/core`/`packages/db`), `pnpm typecheck` (clean, all 6 packages), `pnpm build` (succeeds).

## Design Notes

Combobox is a plain filtered list inside `Popover`/`PopoverContent`, not a new `cmdk`/Radix-Select dependency. Shape: `Input`-styled trigger -> `PopoverContent` with a search `Input`, filtered `DropdownMenuItem`-styled rows, trailing "+ Add New Project" row expanding `ProjectQuickAddForm` inline -- never a second `Dialog`.

## Verification

**Commands:**
- `pnpm --filter @niveshbook/ui test` / `pnpm --filter web test` -- pass
- `pnpm lint && pnpm typecheck` -- clean, no dependency-cruiser violations
- `pnpm build` -- succeeds; spot-check visually per the `packages/ui` Tailwind `@source` gotcha

**Manual checks (if no CLI):**
- Owner/Admin: quick-add from both surfaces; confirm auto-select.
- Partner/Sub-partner: confirm "+ Add New Project" never renders.
