<!-- bmad:context -->
<!-- Verified 2026-09-23 against 33044d4e77a22616b42ddc6e16d910f159974a94. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## NiveshBook

Monorepo (pnpm + Turborepo) for NiveshBook, a partner/investment-tracking app. Architecture decisions live in `_bmad-output/planning-artifacts/architecture/architecture-NiveshBook-2026-09-22/ARCHITECTURE-SPINE.md`; epics/stories in `_bmad-output/planning-artifacts/epics.md`; sprint status in `_bmad-output/implementation-artifacts/sprint-status.yaml`.

## Policy

- Follow SOLID in all application code: single-responsibility modules/functions; extend via new implementations rather than editing stable ones (Open/Closed); any `packages/core` port implementation (e.g. `packages/db`) must be substitutable without changing caller code (Liskov); keep port interfaces narrow and role-specific, not one wide interface (Interface Segregation); callers depend on `packages/core`'s port interfaces, never directly on a concrete implementation like `packages/db` or a DB driver (Dependency Inversion).
- Import direction is enforced by `pnpm lint` (`dependency-cruiser`, `.dependency-cruiser.cjs`): `packages/core` → `packages/types` only, never `packages/db` or `apps/web`; `packages/db` → `packages/core`/`packages/types` only, never `apps/web`. A violation fails lint, not just code review.
- Every `app/api/**/route.ts` handler calls `packages/core`'s `authorize()`/`authorizeScope()` before touching data (AD-1) — never infer a permission from client-supplied data.
- `.github/workflows/ci.yml` runs `pnpm lint` (incl. `eslint-plugin-security`), `typecheck`, `test`, `build`, and `pnpm audit` on every push to `main` and every PR — required green before merge, not advisory.
- UI work reuses `packages/ui`'s existing components (Button, Card, PageHeader, EmptyState, StatusChip, Amount, StatCard, WalletHero, Table, ShareRow/DistributedCheck, SplitRow, AdjustPersonCard, Trail/TraceBanner, ReportTile, NavItem, Helper, Toaster, Dialog/Popover/DropdownMenu) — never hand-roll a duplicate inline in `apps/web`. In particular: every screen's title block uses `PageHeader`, and every list screen's "nothing here yet" state uses `EmptyState` — a 2026-09-24 UI audit found both re-implemented ad hoc per page, which is exactly the drift this rule exists to prevent. Same Open/Closed discipline as above: a story needing UI not yet covered adds it to `packages/ui` first, so the next story reuses it too, instead of forking a one-off version.

## Where things are

- UI components: `packages/ui/src/index.tsx` (barrel export). Visual spec + tokens: `_bmad-output/planning-artifacts/ux-designs/ux-NiveshBook-2026-09-23/DESIGN.md` and `EXPERIENCE.md`, sourced from the founder mockup in that folder's `imports/`.

## Running and verifying

- `pnpm audit` must show zero vulnerabilities before merging a dependency bump — same command CI runs (root script wraps pnpm's own audit, full scope including dev tooling). Example: the Next.js pin was bumped 16.2.10 → 16.3.6 on 2026-09-23 to clear 2 critical unauthenticated-RCE CVEs this audit caught; a pnpm override pins `esbuild` to `>=0.25.0` to clear a moderate finding in `drizzle-kit`'s transitive dev dependency.
- Dashboards, Money History, and report views must return in under 2 seconds at expected data volume (NFR10) — no automated perf check exists yet; treat this as a manual review criterion on any story touching those views until one is added.

<!-- /bmad:context -->

## UI build gotchas (read before touching `packages/ui` styling)

- `packages/ui` ships as source with no build step (`package.json`'s `"main": "./src/index.tsx"`) — `apps/web` consumes it straight through the pnpm workspace symlink at `node_modules/@niveshbook/ui`. Tailwind v4's automatic content detection excludes `node_modules` by default, so any utility class used *only* inside `packages/ui/src` (i.e. not coincidentally duplicated somewhere in `apps/web`'s own files) silently produces no CSS at all — no error, no warning. `packages/ui/src/styles/tokens.css` has `@source "../";` specifically to force that scan. Do not remove or narrow it; if the CSS entry file ever moves or `packages/ui`'s structure changes, re-verify the `@source` path still covers the new location.
- This class of bug is invisible to every normal check: the className string looks correct, typecheck/lint/tests all stay green, and a quick screenshot glance can still look "close enough" — a 2026-09-24 audit shipped `NavItem`'s badge rendering at 14px instead of the specified 22px, and every `Card`'s padding at 0px instead of 20px, both for weeks, undetected. Before calling a new fixed-size, padding, or spacing value in a `packages/ui` component done, measure it in an actual build — `getBoundingClientRect()` / computed style via Playwright — not just an eyeballed screenshot. A wrong-by-8px badge or a collapsed padding is easy to miss at a glance and easy to catch with one measurement.

## Concurrency note

- An autonomous build agent may run against this same working tree in the background, committing story work directly to `main` (stash/reset/amend cycles). If a `git status`/`git diff` check on your own in-progress edits comes back unexpectedly clean or reverted mid-session, don't assume you lost work — re-check a few seconds later; it's very likely a transient snapshot caught mid-cycle, not a real loss (seen twice in the 2026-09-24 session, both times transient). Never run a destructive git command (`reset --hard`, `checkout .`, `clean -f`) to "fix" an apparent collision — just re-verify.
- `git add <specific-path>` only protects you when the *whole file's* uncommitted content is yours. If the concurrent agent has an in-progress, uncommitted edit in the exact same file you're fixing, staging by path stages theirs too — silently, since it's on disk when you `git add`, and it looks identical to your own change in `git status`. Before committing a file you didn't fully re-read top to bottom this session, `git diff <path>` it first and check every hunk is one you actually authored. This shipped a broken production build once already (2026-09-24: an add-money page fix's commit swept in another session's half-written Story 3.8 code, whose import referenced a function not yet committed anywhere, breaking the Vercel build). If it happens again, don't edit the live file to fix it (it may still be under active concurrent edit) — reconstruct the correct tree via git plumbing (`git show <path>` at the last-known-good commit, apply just your diff to that extracted copy, `git hash-object -w`, swap it into a tree via a scratch `GIT_INDEX_FILE`, `git commit-tree`, `git update-ref`) so the fix commit never touches the working directory and the other session's in-progress edit reappears as an ordinary uncommitted diff afterward, undisturbed.

