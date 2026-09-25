---
title: 'Owner/Admin Dashboard'
type: 'feature'
created: '2026-09-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '08b9b0dc93c62140be89d9dda499eaf3a2ad4e19'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FR-35 asks for an uncluttered Owner/Admin home view — Total Project Money, Total Added, Total Withdrawn, Available Balance, and a partner-wise overview — replacing `apps/web/app/(dashboard)/home/page.tsx`'s current placeholder, which explicitly names this story as its successor. Two of the five terms (a precise definition of "Total Project Money" distinct from "Total Added," and "partner-wise overview"'s exact shape) have no formula, worked example, or matching mockup anywhere in the PRD/epics/UX docs — genuinely undocumented, not derivable.

**Approach:** Confirmed with the user 2026-09-25:
1. **"Total Project Money" = net current position** = `Total Added − Total Withdrawn`, system-wide across every Project — a distinct, meaningful headline number ("how much money my projects currently hold"), not a duplicate of Total Added. Mirrors Story 4.9's Can Take fix's exact defensive pattern (`compareMoney` first, clamp to `"0"` rather than let `subtractMoney` throw, since a data-integrity edge case — e.g. a cancelled investment after a valid withdrawal — could otherwise make withdrawn exceed added).
2. **"Partner-wise overview" reuses `AdjustPersonCard`'s richer shape** (name + several label/value lines + a resolution slot), one card per CURRENT top-level Partner Share (not per real person — `partnerId` isn't stable across Projects anywhere in this app's data model, Story 4.9's established finding; this mirrors every other feature's identical per-share, not per-person, treatment). Sub-partners are excluded from this overview — "partner-wise" reads literally as top-level Partners; their own dashboard is Story 5.6's job, and showing sub-partner-level detail here would clutter a screen FR-35 explicitly calls "a handful of cards, not a data dump."
3. **This story stays entirely inside the already-Owner/Admin-gated dashboard shell.** No new `authorize.ts` action — `requireOwnerAdminSession()` (the `(dashboard)` layout's existing gate) already provides exactly the access control this page needs; every underlying read is a direct `packages/core`/`packages/db` port call from the page's own server-side data-fetching, mirroring how `adjust-next-time/page.tsx`/`money-history/page.tsx` already describe themselves as running "behind the gated shell."
4. **One `listAll()`-shaped read per source table, reused for both the system-wide totals and the per-partner breakdown in a single pass** — mirrors Story 5.1's exact `investmentTransactions.listAll()`/`withdrawalTransactions.listAll()` precedent (already built, zero new methods needed there); `available_balances` (the ledger, not the spend log) gets ONE new `listAll()` method, mirroring the other four ports' identical Story 5.1 shape (nothing like it exists yet — only `listBalancesByProjectId`/`findBalance`, both narrower). A new pure `packages/core` function groups/sums this data by `(partyType, shareId)` once, producing both the 4 system-wide stat-card numbers and the partner-wise rows from the same fetch — not two separate round trips.
5. **`WalletHero` is NOT used here** — DESIGN.md/`packages/ui`'s own doc comment scope it to exactly one screen (`/projects/[id]/available-balance`) only. All 5 dashboard metrics use plain `StatCard`, matching EXPERIENCE.md's "4-up, then 3-up" dashboard-row convention.

## Boundaries & Constraints

**Always:** Every sum uses `sumMoney`/`subtractMoney`/`compareMoney` (AD-2) — never raw arithmetic. `Total Added`/`Total Withdrawn` only count `status: "active"` rows (mirrors every existing active-only sum in this codebase, e.g. `sumActiveAmountByProjectId`). The partner-wise overview only includes CURRENT Partner Shares (via the existing `listAllCurrentPartnerShares()`, Story 2.7), never a stale prior version.

**Never:** No new `authorize.ts` action (Decisions #3). No `WalletHero` usage outside its existing single reserved screen. No Sub-partner rows in the partner-wise overview (Decisions #2 — Story 5.6's job). No change to `assembleMoneyHistory()`, `assembleMoneyTrail()`, or any existing port method's behavior — only one new additive `listAll()` on `AvailableBalancePort`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Multiple Projects with activity (AC) | Several Projects, various investment/withdrawal/balance activity | 5 cards: Total Project Money, Total Added, Total Withdrawn, Available Balance, partner-wise overview — "a handful of cards, not a data dump" | N/A |
| Total Project Money, healthy data | Added > Withdrawn system-wide | `subtractMoney(totalAdded, totalWithdrawn)` | N/A |
| Total Project Money, data-integrity edge case | Withdrawn ≥ Added (e.g. a cancelled investment after a valid withdrawal, Story 4.9's precedent) | Clamped to `"0"`, never throws | N/A |
| No activity anywhere yet | Fresh install, no Projects/transactions | All 4 stat cards show `"0"`; partner-wise overview shows an `EmptyState`, not a crash | N/A |
| Partner-wise overview, multiple current Partners | Several Projects, several current Partner Shares | One `AdjustPersonCard`-shaped row per current Partner Share (by `(partyType="partner", shareId)`), each showing their own Invested/Withdrawn/Available Balance totals across every Project they're linked to | N/A |
| A Sub-partner's own activity | Sub-partner has recorded transactions | Rolled into their PARENT Partner's totals (money is still theirs at the Partner level for this rollup) but the Sub-partner gets no own row — matches Decisions #2 | N/A |
| Non-Owner/Admin caller | Any other role | Never reaches this page — the existing `(dashboard)` shell gate rejects before rendering | N/A (unchanged, pre-existing) |

</frozen-after-approval>

## Code Map

- `packages/core/src/available-balance-port.ts` — add `AvailableBalancePort.listAll(): Promise<AvailableBalance[]>`, mirroring `AvailableBalanceSpendPort.listAll()`'s existing Story 5.1 shape exactly (plain, unfiltered, no pagination).
- `packages/db/src/ports.ts` — implement the new `listAll()` (plain `select().from(availableBalances)`, mirrors every existing `listAll()` implementation's identical shape).
- `packages/core/src/owner-admin-dashboard.ts` (new) — pure function `assembleOwnerAdminDashboard(raw: { investmentTransactions, withdrawalTransactions, availableBalances, currentPartnerShares }): OwnerAdminDashboardSummary`. Filters investment/withdrawal transactions to `status: "active"`, sums via `sumMoney` for the 4 system-wide totals (`totalProjectMoney` via `compareMoney`-guarded `subtractMoney`, clamped to `"0"`), then groups the same active rows + available balances by `partyType === "partner"` + `shareId` (a Sub-partner's own rows roll up into their `partnerId`'s totals — need the Sub-partner Share's own `partnerId` field to do this rollup, already available on `SubPartnerShare`) to build one `PartnerOverviewRow` per current Partner Share (`invested`/`withdrawn`/`availableBalance`, each `sumMoney`'d).
- `packages/core/src/index.ts` — barrel-export the new module.
- `apps/web/app/(dashboard)/home/page.tsx` (existing placeholder, replace) — a server component (mirrors this app's existing server-component dashboard-page precedent, no new API route needed — the page itself is already behind `requireOwnerAdminSession()` via the `(dashboard)` layout, Decisions #3) that constructs the 4 ports server-side, calls `.listAll()` on each (`investmentTransactions`, `withdrawalTransactions`, `availableBalances`) plus `listAllCurrentPartnerShares()`, calls `assembleOwnerAdminDashboard()`, and renders: a 4-up `StatCard` row (Total Project Money, Total Added, Total Withdrawn, Available Balance — all `format="money"`) followed by the partner-wise overview as a list of `AdjustPersonCard`s (`lines`: Invested/Withdrawn/Available Balance; `resolution`: implementer's call on a concise, non-duplicate final line — e.g. how many current Projects that Partner is linked to). `EmptyState` (existing component) when there are zero current Partner Shares at all.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/core/src/available-balance-port.ts` + `packages/db/src/ports.ts` — new `listAll()` + live-Postgres test
- [ ] `packages/core/src/owner-admin-dashboard.ts` + tests — all 4 system-wide sums (incl. the clamp-to-zero edge case), the per-partner grouping/rollup (incl. a Sub-partner's activity correctly rolling into their parent Partner), zero-activity case
- [ ] `apps/web/app/(dashboard)/home/page.tsx` + test — renders all 5 cards correctly, `EmptyState` when no current Partner Shares exist

**Acceptance Criteria (from epics.md Story 5.4):** see the frozen I/O matrix above — the single epics.md AC ("Given multiple projects with activity, when Owner/Admin opens their dashboard, then they see Total Project Money, Total Added, Total Withdrawn, Available Balance, and a partner-wise overview — a handful of cards, not a data dump") is represented by matrix row 1, with rows 2-6 covering the terms' precise, otherwise-undocumented mechanics this spec had to define.

## Implementation Notes

- **Code Map widening (mirrors `money-history.ts`'s own precedented widening of its spec's Code Map):** `assembleOwnerAdminDashboard()`'s raw input ended up needing two fields beyond the Code Map's literal `{ investmentTransactions, withdrawalTransactions, availableBalances, currentPartnerShares }`: `currentSubPartnerShares` (the Code Map's own prose already anticipated this -- "need the Sub-partner Share's own `partnerId` field to do this rollup" -- but omitted it from the destructured shape) and `projectNamesById` (needed to resolve each `PartnerOverviewRow.projectName`, mirroring `MoneyHistoryRawData.projectNamesById`'s identical role/key shape). `apps/web`'s `home/page.tsx` builds `projectNamesById` via `Object.fromEntries(projects.map((p) => [p.id, p.name]))`, the exact line `GET /api/money-history`'s route already uses.
- **`resolution` slot content (left to implementer's judgment by the Code Map):** chose "Net Position" (`invested - withdrawn`, clamped to `"0"` via the identical `compareMoney`-then-`subtractMoney` pattern used for the headline Total Project Money stat card) rather than the Code Map's own example ("how many current Projects that Partner is linked to"). That example doesn't actually vary: `addPartnerShare`/`addSubPartnerShare` mint a fresh `partnerId`/`subPartnerId` on every call, so a `PartnerShare` row is inherently scoped to exactly one Project by construction -- every row's own "Project count" would trivially read "1", never a useful distinguishing figure. Instead, WHICH Project a row belongs to is shown directly in the `AdjustPersonCard`'s own `name` field (`` `${row.name} — ${row.projectName}` ``), mirroring `adjust-next-time/page.tsx`'s existing verbatim `${personName} — ${projectName}` convention -- freeing the `resolution` slot for a genuinely new, non-duplicate number instead.
- **Stat-card row layout:** 4-column grid, `gap-3` (12px), collapsing to 2-column under 760px -- taken directly from the founder mockup's own Owner/Admin home screen (`imports/founder-mockup.html`'s `.cards-row` CSS + its first `cards-row` div), the one part of that screen this story's frozen Intent didn't redefine. `tone="success"` is applied only to the Available Balance card, matching that same mockup markup (`class="stat-value num success"` on the Available Balance cell only, the other three plain) -- adapted for this story's confirmed 4-card label set (`Total Project Money` replacing the mockup's `Total Projects`; `Total Added` shortened from `Total Money Added`).
- **`LogoutButton` retained** as `PageHeader`'s `action`, unchanged from the placeholder it replaces -- it's currently the only reachable "log out" control inside the `(dashboard)` shell (not present in `SidebarShell`/the sidebar nav), so removing it here would have been a real regression, not just a visual simplification.
- **Live verification method:** no browser/E2E harness is available in this environment. Verified the real data path end-to-end via a temporary (not committed) live-Postgres integration test in `packages/db` that exercised the genuine write paths (`recordTransaction`, `cancelTransaction`, `creditBalance`, `createPartnerShare`/`createSubPartnerShare`) across two seeded Projects, then read them back via the same four `listAll()`/`listAllCurrent*Shares()` calls `home/page.tsx` itself makes and fed them through the real `assembleOwnerAdminDashboard()`. Confirmed: a Partner's own activity (₹7,00,000 invested) plus their Sub-partner's own activity (₹2,00,000 invested, ₹40,000 withdrawn, ₹1,500 available balance) rolled up into exactly one row (₹9,00,000 invested / ₹40,000 withdrawn / ₹6,500 available balance) with the Sub-partner getting no row of its own; a second, unrelated Partner's own cancelled ₹9,99,999 investment was correctly excluded from every sum (₹3,00,000 invested, matching only the active row). Deleted after the check passed -- `packages/core/src/owner-admin-dashboard.test.ts` (pure-function unit coverage) and `packages/db/src/available-balance-port.test.ts`'s new `listAll` cases (live-Postgres port coverage) are the permanent, committed test coverage; the empty-Project/zero-Partner-Shares case is covered by `apps/web/app/(dashboard)/home/page.test.tsx` instead of a manual browser check.

## Spec Change Log

## Review Triage Log

3-layer review (blind-hunter, edge-case-hunter, verification-gap), 2026-09-25 -- no functional bugs found (all three independently confirmed the money-math, status filtering, and Sub-partner rollup are correct); all 6 findings were test-coverage gaps plus one architectural cleanup, all applied:

1. **[Applied]** Moved `netPosition`'s clamp-to-zero calculation out of `apps/web/home/page.tsx` (was duplicating the `totalProjectMoney` clamp pattern with zero test coverage) into `assembleOwnerAdminDashboard()` as a new `PartnerOverviewRow.netPosition: Money` field, computed with the same `compareMoney`-then-`subtractMoney` pattern. The page now just reads `row.netPosition`. Covered by 3 assertions/1 dedicated test in `owner-admin-dashboard.test.ts` (incl. the clamp-to-zero case).
2. **[Applied]** Added `owner-admin-dashboard.test.ts`'s "a resolvable Sub-partner whose parent partnerId has no current Partner Share" test -- distinct from the pre-existing "orphan-sub" test (which has no `SubPartnerShare` at all); this one has a `SubPartnerShare` that DOES resolve to a `partnerId`, but that `partnerId` is absent from `currentPartnerShares`. Confirms the documented behavior: counted system-wide, no `partnerOverview` row.
3. **[Applied]** Added `owner-admin-dashboard.test.ts`'s "excludes a cancelled transaction from a specific partner's own row" test -- the spec's Verification section claimed this was already covered; no prior test combined a cancelled transaction with a per-partner assertion.
4. **[Applied]** Removed `available-balance-port.test.ts`'s tautological `"returns [] when no balances have ever been credited"` test (asserted an unrelated seeded `projectId` was absent from `listAll()`'s result, which would pass even if `listAll()` were badly broken) -- the adjacent "returns every balance row... unfiltered" test already provides the real positive-coverage evidence.
5. **[Applied]** Added `page.test.tsx`'s "multi-Partner, multi-Project case" test -- the prior "populated case" fixture had only one `currentPartnerShares` entry, so `summary.partnerOverview.map(...)`'s multi-row rendering was never exercised at the page level (only at the pure-function level).
6. **[Applied]** Added `page.test.tsx`'s "PartnerOverviewCard genuinely renders AdjustPersonCard" test -- calls `PartnerOverviewCard({ row })` directly and walks its own returned tree, proving the real `packages/ui` component is used (not a hand-rolled duplicate) and that `row` data is threaded through to the right props.

## Verification

**Commands:**
- `pnpm --filter @niveshbook/core test` — expected: `owner-admin-dashboard.test.ts` covers every I/O matrix row, incl. the clamp-to-zero edge case and the Sub-partner-rolls-into-parent-Partner rollup
- `pnpm --filter @niveshbook/db test` — expected: live-Postgres test for the new `AvailableBalancePort.listAll()`
- `pnpm --filter @niveshbook/web test` — expected: page test covers the populated case (all 5 cards, correct numbers) and the empty case
- `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm lint:boundaries` — expected: clean
- **Live verification:** as Owner/Admin, confirm the dashboard's 4 stat-card numbers match manually-computed totals across several Projects with investment/withdrawal/available-balance activity, confirm a Sub-partner's own recorded activity correctly appears in their parent Partner's row (not its own row), confirm the page renders sensibly with zero data on a fresh Project.
