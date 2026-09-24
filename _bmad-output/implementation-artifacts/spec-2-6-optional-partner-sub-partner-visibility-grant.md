---
title: 'Optional Partner→Sub-partner Visibility Grant'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
baseline_commit: '5f08ec1187f98deb01ecfa76145886974a8c6667'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Partner has no way to let their own Sub-partners see the Partner's total Share % — Story 2.5 deliberately blocks a Sub-partner from seeing anything about the parent Partner at all. `epics.md`'s "Decisions Locked" #2 already scoped this precisely: the grant covers **the Partner's total Share % only** — never adjustment, payment, or balance detail (none of which exist yet anyway).

**Approach:** Add a `subPartnerVisibilityGrant: boolean` column to `partner_shares` (the architecture already anticipated this exact flag — `epic-2-context.md`'s Technical Decisions calls out "a future visibility-grant flag" as explicitly *not* bound by AD-3's `sharePercent`-only immutability rule). Owner/Admin toggles it through the *existing* Add/Edit Partner dialog and `PATCH`, exactly like Story 2.4's `linkedUserEmail` field. Add a new `GET` to the existing (currently `PATCH`-only) `apps/web/app/api/projects/[id]/partner-shares/[partnerId]/route.ts`: Owner/Admin gets the full row; a Sub-partner linked to *this specific Partner* gets a minimal `{ sharePercent }` projection if-and-only-if the grant is on; everyone else — a different Partner's Sub-partner, an unrelated Partner, a Sub-partner when the grant is off — gets the same uniform 403 established in Stories 2.4/2.5, collapsing every denial reason (wrong Partner, grant off, malformed id, nonexistent id) into one response so nothing is distinguishable to an unauthorized caller.

**Decisions (resolved 2026-09-24):**
- **Owner/Admin-only toggle, not Partner self-service.** epics.md's AC is framed around "Partner A enables/toggles the grant" but never states the *mechanism* — and every prior story in this epic (2.4, 2.5) explicitly deferred any non-Owner/Admin *write* capability, citing the dashboard shell staying closed until a story builds real Partner-facing UI (`epics.md`'s Epic 5, Stories 5.5/5.6). A Partner self-service toggle would be this epic's first non-Owner/Admin write — a genuinely bigger step than anything built so far, and not required: the AC's testable behavior (grant on/off → Sub-partner visibility on/off, live) is fully satisfied by Owner/Admin toggling it via the existing edit flow while the *read* side enforces the boundary. Self-service toggling is deferred to whichever story builds Partner-facing UI.
- **Reuses `partner_shares`'s existing versioned-row mechanism — no new table, no in-place update path.** `subPartnerVisibilityGrant` threads through `addPartnerShare`/`updatePartnerShare` exactly like `userId` did in Story 2.4: every edit (including a grant toggle) creates a new version row carrying the field forward. `epic-2-context.md`'s "not bound by AD-3 immutability" note means grant history doesn't need preserving the way `sharePercent` does — it doesn't mandate a separate non-versioned mechanism, and building one would be new surface area for no required benefit.
- **The read-side grant check is strictly narrower than the write-side toggle.** The new `GET .../partner-shares/[partnerId]` returns the *full* `PartnerShare` object to Owner/Admin, but only `{ sharePercent }` to an authorized Sub-partner — never `name`, `userId`, `id`, `effectiveFrom`, or `createdAt`, per "Decisions Locked" #2's literal "total Share % only." A 200 response itself signals "the grant is on and you're authorized to see it" — no redundant `granted: true` field.
- **Membership check reuses Story 2.4's `SCOPE_SELF_ACCESS_ACTIONS`/`authorizeScope()` mechanism, applied one level down.** A new action, `"partner_shares:view_grant"`, checks whether the caller's `userId` is among this specific Partner's *current* Sub-partner Shares' `userId`s (via the existing `listCurrentSubPartnerShares` — no new port method). The grant flag itself (`partner.subPartnerVisibilityGrant`) is a separate, additional business-rule condition checked in the route, not inside `authorize.ts` — both must hold, and failing either collapses to the identical uniform 403, so no caller can tell "wrong Partner" from "right Partner, grant off."
- **No existence oracle, learning directly from Stories 2.4's shipped-then-patched bug and 2.5's by-design fix.** Path-segment resolution runs the same way for every caller; only Owner/Admin can turn a resolution failure into a 404. Everyone else gets the same 403 for every failure mode — malformed id, nonexistent Partner, wrong Sub-partner, or grant disabled.
- **No changes to Sub-partner-level endpoints or Story 2.5's boundary.** A Sub-partner still cannot see a sibling Sub-partner's row, and still cannot see anything about a Partner they aren't linked under, regardless of that Partner's grant setting.

## Boundaries & Constraints

**Always:** `GET .../partner-shares/[partnerId]` requires a valid session (401 if none). Path resolution (project exists, `partnerId` belongs to it) runs identically for every caller, mirroring the existing `PATCH`'s chain exactly. Owner/Admin always gets `200` with the full row (or the existing granular 404 on a resolution failure). A Sub-partner gets `200` with `{ sharePercent }` only if *both* they are linked to a *current* Sub-partner Share under this specific `partnerId`, *and* `partner.subPartnerVisibilityGrant === true`. Every other case — wrong Partner, grant off, a Partner-role caller, malformed/nonexistent path segments — gets the identical uniform `403 {code: "forbidden"}`. `POST`/`PATCH .../partner-shares[/[partnerId]]` (Owner/Admin-only, unchanged gate and ordering) grow a required `subPartnerVisibilityGrant: boolean` field, full-overwrite every save, matching `linkedUserEmail`'s exact convention from Story 2.4.

**Never:** No Partner self-service write path for the grant — Owner/Admin-only, via the existing dialog/PATCH. No change to `subpartner_shares:*` endpoints or Story 2.5's own Sub-partner-to-Sub-partner boundary. No new table, no new port method — reuses `listCurrentSubPartnerShares` and the existing `partner_shares` versioning. No audit trail for grant toggles (pre-existing gap pattern, same as every other admin action in this codebase so far). No dashboard shell / UI changes for non-Owner/Admin roles.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Grant off, Sub-partner requests Partner detail | Partner A grant=false, Sub1 (linked, under Partner A) | 403, no data | `{code: "forbidden"}` |
| Grant on, Sub-partner requests own-Partner's Share % | Partner A grant=true, Sub1 (linked, under Partner A) | 200, `{ sharePercent: "50" }` only — no name/userId/id | N/A |
| Grant on, but a different Partner's Sub-partner requests it | Partner A grant=true, Sub3 (linked under Partner B) requests Partner A's detail | 403, no data | `{code: "forbidden"}` |
| Grant toggled off again | Partner A grant flips true→false | Sub1's next request returns 403 immediately | `{code: "forbidden"}` |
| Owner/Admin requests any Partner's detail | Any Partner, any grant state | 200, full `PartnerShare` object, unconditional | N/A |
| Owner/Admin toggles the grant | `PATCH` with `subPartnerVisibilityGrant: true/false` | 200, new versioned row (new `id`/`effectiveFrom`, same `partnerId`), grant value updated | N/A |
| Non-Owner/Admin attempts to toggle the grant | Partner or Sub-partner role, `PATCH` | 403, no new version created (unchanged write gate) | `{code: "forbidden"}` |
| Sub-partner probes a nonexistent/malformed `partnerId` | Sub1, bad path segment | 403, not 404 — uniform, no existence oracle | `{code: "forbidden"}` |
| Owner/Admin requests a nonexistent/malformed `partnerId` | bad path segment | 404 (existing granular precedent, unchanged) | `{code: "not_found"}` |
| Unauthenticated request | No session cookie | 401 | `{code: "unauthenticated"}` |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema.ts` — add `subPartnerVisibilityGrant: boolean("sub_partner_visibility_grant").notNull().default(false)` to `partnerShares`.
- `packages/db/drizzle/*` — generate migration.
- `packages/types/src/index.ts` — `PartnerShare` gains `subPartnerVisibilityGrant: boolean`.
- `packages/core/src/partner-share-port.ts` — `CreatePartnerShareInput` gains `subPartnerVisibilityGrant: boolean`.
- `packages/core/src/partner-share.ts` — `PartnerShareInput` gains `subPartnerVisibilityGrant: boolean` (always explicitly provided, full-overwrite, mirrors `userId`'s Story 2.4 pass-through exactly); `addPartnerShare`/`updatePartnerShare` thread it straight through.
- `packages/db/src/ports.ts` — `createPartnerSharePort`'s `createPartnerShare` persists the new column; `toPartnerShare` mapper includes it.
- `packages/core/src/authorize.ts` — add `"partner_shares:view_grant"` to the `Action` union; `PERMISSIONS["partner_shares:view_grant"] = new Set(["owner_admin"])`; add `"partner_shares:view_grant"` to `SCOPE_SELF_ACCESS_ACTIONS` (reuses `authorizeScope()`'s existing `scopeOwnerIds` mechanism from Story 2.4 unchanged — zero new logic, purely additive constants).
- `apps/web/app/api/projects/[id]/partner-shares/[partnerId]/route.ts` — add `GET`, alongside the existing `PATCH`. Resolves the project/`partnerId` via the same chain `PATCH` already uses. On resolution failure: Owner/Admin gets the existing granular 404; anyone else gets a uniform 403 (mirrors Story 2.5's `resolutionFailed()` pattern exactly). On success: Owner/Admin gets `200` with the full row. Otherwise, compute `scopeOwnerIds` from `listCurrentSubPartnerShares(partnerId, deps)`'s current rows' `userId`s, call `authorizeScope(session.userId, "partner_shares:view_grant", deps, scopeOwnerIds)` — if allowed *and* `partner.subPartnerVisibilityGrant`, `200` with `{ sharePercent: partner.sharePercent }`; otherwise the identical uniform 403. **PATCH**: body validation grows the required `subPartnerVisibilityGrant: boolean`, threaded into `updatePartnerShare`'s input (unchanged authorization gate/ordering).
- `apps/web/app/api/projects/[id]/partner-shares/route.ts` — **POST**: same required `subPartnerVisibilityGrant: boolean` addition, threaded into `addPartnerShare`'s input (unchanged authorization gate/ordering).
- `apps/web/app/api/projects/[id]/partner-shares/shared.ts` — `isValidPartnerShareBody` type guard grows the required `subPartnerVisibilityGrant: boolean` field.
- `apps/web/lib/partner-shares.ts` — client fetch helper input type gains `subPartnerVisibilityGrant: boolean`.
- `apps/web/app/(dashboard)/projects/[id]/shares/page.tsx` — Add/Edit Partner dialog (not the Sub-partner dialog) gains one new checkbox: "Let this Partner's Sub-partners see their total Share %"; `handleSubmit`'s `add`/`edit` branches include it.
- **Existing test files needing updates** (valid-body fixtures now need `subPartnerVisibilityGrant`, or the required-field check rejects them): `apps/web/app/api/projects/[id]/partner-shares/route.test.ts`, `.../partner-shares/[partnerId]/route.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema.ts` + migration — `subPartnerVisibilityGrant` column
- [x] `packages/types/src/index.ts` — `subPartnerVisibilityGrant: boolean` on `PartnerShare`
- [x] `packages/core/src/partner-share-port.ts` + `partner-share.ts` + tests — pass-through
- [x] `packages/db/src/ports.ts` + `schema.test.ts` — persist/map the column
- [x] `packages/core/src/authorize.ts` + tests — `partner_shares:view_grant` action, `PERMISSIONS`, `SCOPE_SELF_ACCESS_ACTIONS`
- [x] `apps/web/app/api/projects/[id]/partner-shares/[partnerId]/route.ts` + tests — new `GET` (grant-gated projection, no-oracle resolution), `PATCH` body extension
- [x] `apps/web/app/api/projects/[id]/partner-shares/route.ts` + tests — `POST` body extension
- [x] `apps/web/lib/partner-shares.ts` — input type extension
- [x] `apps/web/app/(dashboard)/projects/[id]/shares/page.tsx` — grant checkbox on Add/Edit Partner dialog
- [x] Update existing route test fixtures with `subPartnerVisibilityGrant`

**Acceptance Criteria (from epics.md Story 2.6):**
- Given Partner A has not enabled the grant, when Sub1 views their data, then no Partner-A-level context is shown beyond Sub1's own data.
- Given Partner A enables the grant, when Sub1 views their data, then the Partner's total Share % becomes visible to Sub1 and Sub2 — and still not to Partner B or anyone outside Partner A's own sub-partners.
- Given the grant is toggled off again, when Sub1 next requests it, then the previously-visible context is hidden again immediately.

## Implementation Notes

- The Code Map didn't list a `packages/ui` change, but no boolean-toggle component existed there yet, and `AGENTS.md`'s policy requires UI work to reuse (or first add to) `packages/ui` rather than hand-roll a one-off inline control in `apps/web`. Added `packages/ui/src/components/checkbox.tsx` (a minimal `Checkbox`, styled consistently with the existing `Input`) and exported it from the barrel — first consumer is the Add/Edit Partner dialog's grant toggle. No other Code Map file needed changes beyond what was listed.
- Live verification (migration applied to the local dev Postgres; hand-linked two Sub-partners under one Partner and one Sub-partner under a different Partner, mirroring Stories 2.3-2.5's approach) confirmed every I/O matrix row end-to-end, then the fixtures were deleted to leave the dev DB clean.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | (edge-case-hunter) `packages/ui/src/components/checkbox.tsx`'s `<input type="checkbox" className={...} {...props} />` puts the hardcoded `type="checkbox"` *before* `{...props}` — a caller passing a `type` prop (valid per `InputHTMLAttributes<HTMLInputElement>`) would silently override it, breaking the control. | medium (real, latent — no exploitable call site exists today) | Confirmed directly: JSX spread order means a later `type` in `props` wins. The one actual consumer (`shares/page.tsx`) doesn't pass `type`, so nothing is broken *today*, but the component's whole purpose is to *be* a checkbox — allowing this override is a real defect in newly-added code, not inherited from anywhere. | patch |
| 2 | (edge-case-hunter) The new `GET .../partner-shares/[partnerId]` reuses `partner.projectId !== projectId`'s case-sensitive JS string comparison (vs. Postgres's case-insensitive `uuid` column comparison). | medium (real, but pre-existing, not caused by this story) | Same exact issue already found and deferred during Story 2.5's review — inherited unchanged from `PATCH`'s pre-existing code in this same file, which this story's spec explicitly directed the new `GET` to mirror. Not introduced by this diff; existing `deferred-work.md` entry (from spec-2-5) updated to note it now also applies here. | defer |
| 3 | (verification-gap) No automated test would catch `subPartnerVisibilityGrant: input.subPartnerVisibilityGrant` being dropped from the real Drizzle insert in `packages/db/src/ports.ts`'s `createPartnerShare` — the column's DB-side default makes the field type-optional in the insert, so TypeScript wouldn't flag its omission, and every test that touches this field mocks the port or uses an in-memory fake, never the real Drizzle code. | medium (real, systemic, pre-existing — not new to this story) | Verified: no DB-integration test tier exists anywhere in this repo for `packages/db/src/ports.ts` — none of `createPartnerShare`'s *other* fields (`name`, `sharePercent`, `userId`) have real-DB round-trip coverage either. Matches the exact, already-tracked gap from Story 1.1's `deferred-work.md` entry ("`packages/db/src/ports.ts` has zero test coverage against a real database"), which already lists affected methods per story. My own live verification against the real dev Postgres *did* directly confirm (via SQL) that the grant toggle persists correctly right now — this finding is about protecting against a *future* regression, not a current bug. Existing entry updated to include this story's field. | defer |
| 4 | (blind-hunter) The "no existence oracle" design only holds at the response-body level — a malformed id, a nonexistent Partner, and a "wrong Partner/grant off" case take different code paths with different DB-call counts, a theoretical timing side-channel. | false | Same class of finding already rejected in Story 2.5's review: no demonstrated harm, never treated as in-scope anywhere else in this codebase, and the actual vulnerability class both prior stories shipped/patched (a *response-code* oracle) is closed here by design. | — |
| 5 | (blind-hunter + verification-gap, same observation) `findUserById(session.userId)` is called once in the route (owner_admin check) and again inside `authorizeScope()` for a denied non-owner_admin caller — a redundant DB round-trip. | false | Functionally harmless (same result both times), matches the same class of minor redundancy already present in Stories 2.4/2.5's `resolutionFailed()` patterns — no demonstrated harm, not a new inefficiency class. | — |
| 6 | (blind-hunter) No UI indicator on the Partner row itself showing which Partners currently have the grant enabled (only visible by opening Edit). | false | Not required by any AC — a scan-at-a-glance indicator is a UX enhancement, not a stated requirement. Scope creep. | — |
| 7 | (blind-hunter) No confirmation/warning copy when toggling the grant on/off, despite it taking effect immediately. | false | Not required by any AC. No other admin action in this codebase (deactivating a user, revoking a session, editing a Share %) has a confirmation dialog either — matches established precedent of direct, unconfirmed admin actions. | — |
| 8 | (blind-hunter) No notification to the affected Partner or Sub-partner(s) when Owner/Admin toggles the grant on their behalf. | false | No notification/messaging system exists anywhere in this codebase (no email, no in-app notifications) — out of scope at this product stage, nothing to hook into. | — |
| 9 | (blind-hunter) "No audit trail for grant toggles" is acknowledged but has no forward reference to a specific future story, unlike some other deferred items. | false | Matches the same general, already-multiply-recorded "no story has built audit logging yet" gap (Stories 1.6, 1.7, 2.1 all cite it identically) — doesn't need its own new forward-referenced entry. | — |
| 10 | (blind-hunter) `Checkbox` has no `id`/label-association contract beyond "wrap it in a `<label>`." | false | Wrapping a checkbox in a `<label>` element is a valid, standard, accessible HTML pattern — the component's own doc comment already states this explicitly. Not a missing contract, a documented, working design choice. | — |
| 11 | (blind-hunter) Migration's DB-level `DEFAULT false` is only exercised by the implicit backfill of pre-existing rows, with no test verifying that. | false | Standard, well-understood Postgres `ADD COLUMN ... DEFAULT` behavior — not something any prior story's migration in this codebase has ever needed a bespoke test for (would be testing Postgres itself, not application logic). | — |
| 12 | (blind-hunter) No test exercises a `sub_partner` actor against a Partner with a *completely empty* current Sub-partner list (only a non-empty-but-non-matching list is tested). | false | Functionally identical code path (`Array.prototype.some`/membership check returns `false` either way) — redundant test-coverage ask, not a genuine gap in confidence. | — |
| 13 | (blind-hunter) `authorize.ts`'s comment on `partner_shares:view_grant` could be read as conflating the `PERMISSIONS` table with the route's full-row-vs-projection decision. | false | Re-read directly: the comment already explicitly attributes the full-row decision to "the route layer," not to `PERMISSIONS` — already sufficiently precise. | — |
| 14 | (blind-hunter) Ambiguous scope of the implementer's own "fixtures deleted" cleanup claim (unclear if Sub-partner login/user rows were included). | — (superseded) | Not a code defect — a precision nitpick about the implementer's report prose. Moot regardless: my own independent live re-verification created and fully deleted its own separate fixture set, confirmed via `DELETE` row counts. | — |

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `authorize.test.ts` covers `partner_shares:view_grant`'s scope-based cases; `partner-share.test.ts` covers `subPartnerVisibilityGrant` pass-through
- `pnpm --filter @niveshbook/db test` — expected: schema-shape assertion for the new column
- `pnpm --filter @niveshbook/web test` — expected: new `GET` tests cover every I/O matrix row incl. uniform-403-not-404; `POST`/`PATCH` tests cover the new required field; all pre-existing tests updated and passing
- `pnpm lint` — expected: clean
- `pnpm typecheck` — expected: clean across all packages
- `pnpm build` — expected: clean
- **Live verification (required, given this story's security-relevant nature):** apply the migration; hand-link two Sub-partners under one Partner and one Sub-partner under a different Partner (mirroring Stories 2.3–2.5's hand-SQL session approach); confirm grant-off → 403, grant-on → 200 with `{sharePercent}` only for both of the correct Partner's own Sub-partners, the other Partner's Sub-partner still 403 regardless of grant state, and toggling the grant off again immediately reverts to 403 — plus Owner/Admin's unconditional full-object access and the granular 404 for a genuinely bad id.
