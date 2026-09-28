---
title: 'Quick-Add User in the Partner/Sub-partner Share Dialog'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '84ad3d8f769ac7d2ef93ce075b68d82f20b0e33e'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Add/Edit Partner and Add/Edit Sub-partner dialogs link a login via a free-text "Linked user (email)" `<Input>` that 400s unless that user already exists — created earlier, elsewhere, on the Users screen — forcing an admin mid-Share-creation to abandon the dialog, create the user, then come back and retype the email.

**Approach:** Replace that field with the `Combobox` primitive (`packages/ui`, built for the sibling quick-add-project spec) searching the existing user directory, role-filtered to `partner` or `sub_partner` per dialog mode, plus an inline "+ Add New User" row. The row's form collects name + email, creates the user via the existing `createUserAccount`/`generatePassword` flow, shows the one-time password inline (same panel, no second popup) with a Copy action, and only then auto-selects the new user on the Share and fills the Share's own Name field if it was empty. Reuses `createUserAccount`, `resolveLinkedUserId`, `listUsers` unchanged — no new API route, no schema change.

## Boundaries & Constraints

**Always:**
- Reuse `createUserAccount`/`generatePassword`/`POST /api/users` as-is — same gate, validation, duplicate-email 400.
- "+ Add New User" only renders when the session passes `users:create` (`owner_admin`-only) — already matches `partner_shares:create`/`subpartner_shares:create`'s own `owner_admin`-only gate, so no session can see the row but 403 on submit.
- New user's role is the dialog's own expected role (`partner`/`sub_partner`) — never caller-chosen.
- Typed "Name" sets the *Share's* own `name` field only when it's still empty — never overwrites one already typed.
- Existing-user search filters to expected role + `active: true`, except the Share's currently-linked user is always included regardless, so an already-linked Share never renders blank.
- One-time password shows inline in the same popover panel (a "created" sub-view: Copy + Done, mirroring the Users screen's two-phase pattern) — selection/close only happens on Done, never immediately.
- `addNew` renders inline in the same `Popover`, never a second `Dialog` — already solved by `Combobox`'s existing design.

**Never:**
- Do not expand any `authorize.ts` scope, or add a `name` column to `users`.
- Do not touch the withdrawal "Person" field or the destination-Project pickers (tracked separately).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Quick-add, Add Partner/Sub-partner dialog | "+ Add New User", name + email | `createUserAccount` with `generatePassword()`, dialog's own role; password shown inline w/ Copy; on Done, Share's `userId` set, `name` filled if empty | N/A |
| Duplicate email | Quick-add form, existing email | Existing 400 ("Email already in use.") shown inline, form stays open | Mirrors Users screen |
| Search existing user | Typing in Combobox | Client-side filter over `listUsers()`, role + `active:true`, always including the currently-linked user | No matches → only "+ Add New User" |
| Edit dialog, linked user now inactive | Open dialog | Inactive linked user still appears, pre-selected | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/app/(dashboard)/projects/[id]/shares/page.tsx:149,247-268,591-623` — replace the free-text `linkedUserEmail` `<Input>` with the role-filtered user `Combobox`; the raw `fetch("/api/users")` effect (builds `userEmailById`) becomes `listUsers()` (`apps/web/lib/users.ts:119`), also feeding the Combobox's options; `linkedUserEmail` state becomes a selected-id + resolved-email pair.
- `apps/web/app/(dashboard)/projects/UserQuickAddForm.tsx` (new) — mirrors `ProjectQuickAddForm.tsx` (name/email, `useId()`, `mountedRef` guard) plus a "created" sub-view (password + Copy + Done); calls `createUserAccount`/`generatePassword` (`apps/web/lib/users.ts:144-243`).
- `apps/web/lib/users.ts:70-93` `resolveLinkedUserId` and the partner/subpartner-shares routes — unchanged; still resolve by email server-side.
- `packages/core/src/authorize.ts` — `users:create`/`users:list`/`partner_shares:create`/`subpartner_shares:create`, all `owner_admin`-only already.
- `packages/ui/src/components/combobox.tsx` — reused unchanged; `addNew.renderForm` composes `UserQuickAddForm`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/app/(dashboard)/projects/UserQuickAddForm.tsx` -- name/email quick-create + inline password-reveal sub-view, calling `createUserAccount`/`generatePassword`
- [x] `apps/web/app/(dashboard)/projects/[id]/shares/page.tsx` -- swap Linked-user `<Input>` for the role-filtered `Combobox` (both Partner/Sub-partner modes); switch to `listUsers()`; wire Share-name auto-fill and always-include-current-link
- [x] Unit tests for the I/O matrix above

**Acceptance Criteria:**
- Given the Add Partner dialog, when the admin picks an existing `partner`-role user, then the Share's linked-user id matches with no free-text entry.
- Given quick-add, when the admin submits a valid name + email, then a user is created with the dialog's own role, the password shows inline with Copy, and only on Done does the Share's linked-user field get set and its Name fill (only if empty).
- Given the Sub-partner dialog's quick-add, when a user is created, its role is `sub_partner`, never `partner`.
- Given a duplicate email, when the API 400s, the same message the Users screen shows renders inline without closing the form.
- Given an Edit dialog for a Share linked to a since-deactivated user, that user still appears, pre-selected.

## Implementation Notes

Implemented directly (no dispatched subagent, given the sibling spec's implementation subagent proved unreliable — repeated connection drops over a ~50-minute run). Two real, non-obvious bugs were found and fixed via actual test execution, not static review — both are documented here since they're general Radix/React composition hazards this app hadn't hit before this spec (the first `Combobox`-inside-`Dialog` composition):

1. **Radix Dialog auto-dismisses on any click inside a nested Popover's content.** `Combobox`'s `Popover` portals its content to `document.body` as a *sibling* of the Dialog's own content, not a descendant — Radix's outside-click detection on `Dialog.Content` can't tell the Popover is logically still "inside" the dialog, so it silently closes the whole Share dialog the instant the quick-add form is touched. Fixed in `packages/ui/src/components/dialog.tsx`: `DialogContent` now defaults `onPointerDownOutside`/`onFocusOutside`/`onInteractOutside` to ignore any event whose target is inside a `[data-radix-popper-content-wrapper]` (the stable Radix marker every `Popper`-based primitive — `Popover`, `DropdownMenu`, etc. — uses for its portaled content). A caller can still override via its own prop (spread after the default, so it wins). New `dialog.test.tsx` covers this directly; the fix benefits every `Dialog` in the app, not just this page, and the full existing test suite (many other Dialogs) stayed green.
2. **A nested `<form>`'s submit event bubbles through React's own tree via the Portal, not just the DOM.** `UserQuickAddForm`'s `<form onSubmit>` renders inside the Combobox's `Popover`, which is portaled elsewhere in the DOM but stays a React-tree descendant of the outer Share dialog's own `<form onSubmit>` — React Portals preserve synthetic-event bubbling through the component tree regardless of DOM position. `event.preventDefault()` alone doesn't stop this; without `event.stopPropagation()` too, clicking "Create User" also silently submitted the *outer* Share form with whatever it currently held (usually blank), which then closed the whole dialog. Fixed by adding `event.stopPropagation()` to both `UserQuickAddForm` and `ProjectQuickAddForm`'s `handleSubmit` (the latter had the same latent bug, just never manifested since it's never nested inside another form yet).

Both were caught via `apps/web/app/(dashboard)/projects/[id]/shares/page.test.tsx`'s own quick-add integration tests actually exercising the full flow end-to-end (submit → password reveal → Done → select) rather than mocking past the interaction — the bugs only appear once cause-and-effect actually run together.

Also renamed two accessible-name collisions surfaced by the same tests: `UserQuickAddForm`'s "Name" field is now "User's name" (the outer Share dialog already has its own "Name" field, both visible at once), and its Save/Cancel buttons are now "Create User"/"Back" (the outer dialog's own Save/Cancel are also on-screen simultaneously). `ProjectQuickAddForm` needed no equivalent rename — it's never composed inside another form.

Full verification: `pnpm --filter @niveshbook/ui test` (97 tests) and `pnpm --filter web test` (1213 tests, run 3x to confirm no flakiness) both pass; `pnpm lint` clean (no new errors, one new pre-existing-pattern `security/detect-object-injection` warning class, already tolerated elsewhere); `pnpm typecheck` clean across all 6 packages; `pnpm build` succeeds. All Tasks marked `[x]`; every I/O matrix row and all 5 Acceptance Criteria have a covering test in `shares/page.test.tsx`.

Nothing left incomplete within this spec's scope.

## Spec Change Log

## Review Triage Log

## Design Notes

`UserQuickAddForm`'s two-phase shape (`"form" | "created"`) is why `onCreated` fires on Done, not right after `createUserAccount()` resolves -- unlike `ProjectQuickAddForm`, there's a one-time password the admin must see first.

## Verification

**Commands:**
- `pnpm --filter web test` / `pnpm lint && pnpm typecheck` / `pnpm build` -- all pass, clean, succeed

**Manual checks (if no CLI):**
- Owner/Admin: quick-add a Partner and a Sub-partner; confirm password shows, Copy works, Done selects, roles are correct.
- Confirm an inactive linked user still appears pre-selected when editing.
