---
title: 'Per-Client Configuration'
type: 'feature'
created: '2026-09-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
baseline_commit: '8558d50fe71cfeb02f111b64c2f68d3ec94767a2'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** AD-7/FR43/FR44 require branding, currency/locale, and enabled-modules to come from one `client.config` resolved from env vars at boot — nothing like this exists yet. `project_admin` ships disabled by default per-client (epic-1-context.md); today it's just a valid role value with no deployment-level toggle, and Story 1.7's Permissions view stood in with a live-usage proxy specifically because this config didn't exist yet.

**Approach:** Add `apps/web/lib/client-config.ts` resolving `{ branding: { appName }, locale, currency, enabledModules: { projectAdmin } }` from `CLIENT_*` env vars (defaults: `NiveshBook` / `en-IN` / `INR` / `projectAdmin: false`). Prove AD-7 against two real spots: `layout.tsx`'s hardcoded page title/description (now derived from config), and `GET /api/permissions` (`enabledRoles.project_admin` sourced from config, not live role usage). FR44's Indian-digit-grouping formatting already exists in `packages/ui/src/lib/format-amount.ts` (concurrent UI work) — not duplicated here; stays hardcoded to INR for now, tracked separately.

## Boundaries & Constraints

**Always:** `client-config.ts` is the only file reading `CLIENT_*` env vars — no other file in `apps/web` or `packages/core` branches on a client identifier (AD-7). `packages/core` never imports `client-config.ts` (AD-9): `getPermissionsOverview` takes the resolved `projectAdminEnabled` boolean as a caller-supplied dependency, same pattern as its existing `PermissionsDeps`. A malformed/missing env var falls back to its documented default rather than throwing.

**Always (decided 2026-09-23):** `enabledRoles.project_admin` in `GET /api/permissions` is sourced entirely from `client.config.enabledModules.projectAdmin`, fully replacing Story 1.7's live-usage computation — not combined with it.

**Never:** No `GET /api/client-config` endpoint — nothing client-side consumes config yet. No change to `packages/ui/src/lib/format-amount.ts` — it stays as-is; making it locale/currency-parameterized is tracked as deferred work, not this story's job. No new `enabledModules` beyond `projectAdmin` — it's the only optional role/module named anywhere in the FRs.

## I/O & Edge-Case Matrix

| Scenario | Env State | Expected Behavior | Error Handling |
|----------|-----------|-------------------|-----------------|
| No `CLIENT_*` vars set | Nothing configured | `{ branding: { appName: "NiveshBook" }, locale: "en-IN", currency: "INR", enabledModules: { projectAdmin: false } }` | N/A |
| Custom values set | `CLIENT_APP_NAME`, `CLIENT_LOCALE`, `CLIENT_CURRENCY`, `CLIENT_ENABLE_PROJECT_ADMIN=true` all set | Config reflects each override | N/A |
| Malformed boolean | `CLIENT_ENABLE_PROJECT_ADMIN=yes` (not `"true"`) | Falls back to `false` (default) | N/A |
| Page metadata reflects branding | `CLIENT_APP_NAME="Acme Capital"` | `layout.tsx`'s `metadata.title`/`description` include "Acme Capital", not the literal string "NiveshBook" | N/A |
| Permissions view reflects config, not usage | `CLIENT_ENABLE_PROJECT_ADMIN=false`, but an active `project_admin` user exists | `GET /api/permissions` → `enabledRoles.project_admin: false` | N/A |
| Permissions view reflects config, not usage (inverse) | `CLIENT_ENABLE_PROJECT_ADMIN=true`, no `project_admin` users exist at all | `GET /api/permissions` → `enabledRoles.project_admin: true` | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/lib/client-config.ts` -- NEW: `ClientConfig` interface; `getClientConfig(): ClientConfig` reads `CLIENT_APP_NAME` (default `"NiveshBook"`), `CLIENT_LOCALE` (default `"en-IN"`), `CLIENT_CURRENCY` (default `"INR"`), `CLIENT_ENABLE_PROJECT_ADMIN` (default `false`, only `"true"` parses as enabled)
- `.env.example` -- document the four new `CLIENT_*` vars with their defaults
- `apps/web/app/layout.tsx` -- derive `metadata.title`/`description` from `getClientConfig().branding.appName` instead of the hardcoded `"NiveshBook"` string
- `packages/core/src/permissions.ts` -- `getPermissionsOverview(deps)` takes a new `projectAdminEnabled: boolean` on `deps`; `enabledRoles.project_admin` becomes that value (per the Open Question's resolution), removing the `listAllUsers()`-based live-usage computation
- `apps/web/app/api/permissions/route.ts` -- pass `projectAdminEnabled: getClientConfig().enabledModules.projectAdmin` into `getPermissionsOverview()`

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/lib/client-config.ts` -- add `getClientConfig()` with documented env vars/defaults
- [x] `.env.example` -- document the four new vars
- [x] `apps/web/app/layout.tsx` -- derive title/description from config
- [x] `packages/core/src/permissions.ts` -- source `enabledRoles.project_admin` from caller-supplied `projectAdminEnabled`, not live usage
- [x] `apps/web/app/api/permissions/route.ts` -- wire `getClientConfig()` into `getPermissionsOverview()`
- [x] Vitest tests: `client-config.ts` covering every I/O Matrix row (defaults, overrides, malformed boolean); `permissions.ts`/route tests updated so `enabledRoles.project_admin` reflects the injected value, not user rows

**Acceptance Criteria:**
- Given `packages/core` and `apps/web` (outside `client-config.ts`), when grepped for `CLIENT_APP_NAME`/`CLIENT_LOCALE`/`CLIENT_CURRENCY`/`CLIENT_ENABLE_PROJECT_ADMIN`, then no match exists outside that one file — client identity is resolved in exactly one place (AD-7).

## Implementation Notes

All tasks complete. Full verification run 2026-09-23:
- `pnpm --filter @niveshbook/core test` -- 59 passed (`permissions.ts` tests rewritten so `enabledRoles.project_admin` reflects the injected `projectAdminEnabled`, never user rows)
- `pnpm --filter web test` -- 81 passed (new `client-config.ts` tests cover every I/O Matrix row; `layout.test.tsx` proves branding derives from `CLIENT_APP_NAME`; `/api/permissions` route tests rewritten around config, not live usage)
- `pnpm typecheck` -- clean across all 6 packages
- `pnpm build` -- clean
- `pnpm lint:boundaries` -- clean, no dependency violations
- Acceptance criterion grep (`CLIENT_APP_NAME`/`CLIENT_LOCALE`/`CLIENT_CURRENCY`/`CLIENT_ENABLE_PROJECT_ADMIN` outside `client-config.ts`): no matches in source files; test files (`client-config.test.ts`, `layout.test.tsx`, `route.test.ts`) legitimately set/unset these env vars to exercise the I/O Matrix rows the spec itself requires — that's test setup, not a second place client identity is resolved in product code.

`PermissionsDeps` (used by `setApprovalAuthority`, unchanged) was kept separate from a new `PermissionsOverviewDeps extends PermissionsDeps` (adds `projectAdminEnabled: boolean`, used only by `getPermissionsOverview`) rather than adding the field to the shared `PermissionsDeps` — the latter would have forced `apps/web/app/api/permissions/[userId]/route.ts` (which only ever needed `users`) to also supply a `projectAdminEnabled` it has no use for.

Same stale-`dist` gotcha as Story 1.6: `apps/web` consumes `@niveshbook/core` via its built `dist/` output, so after editing `permissions.ts` the package needed `pnpm --filter @niveshbook/core build` before the web route tests would see the new config-driven logic — without the rebuild, `enabledRoles.project_admin` silently fell back to the old live-usage computation and three route tests failed in a way that looked like a logic bug but wasn't.

## Spec Change Log

## Review Triage Log

Reviewed 2026-09-23 (blind-hunter, edge-case-hunter, verification-gap). verification-gap: no gaps in this story's own diff (noted an unrelated observation about the `<Toaster />` addition — see below).

**patch** (auto-fixed):
- `getClientConfig()`'s `||`-based fallback (`process.env.CLIENT_APP_NAME || DEFAULT_APP_NAME`, same pattern for locale/currency) only catches unset/empty values, not whitespace-only ones — `CLIENT_APP_NAME=" "` renders a blank browser-tab title instead of falling back to `"NiveshBook"`, contradicting `.env.example`'s documented "any unset or malformed value falls back to its default" — `low`, real, concrete user-visible consequence for `appName`: trim before the fallback check, applied consistently to all three string fields. [apps/web/lib/client-config.ts] — fixed: `resolveStringEnv()` trims before the fallback check for all three fields
- The AC's "no client identity read outside `client-config.ts`" guarantee is only verified by a one-time manual grep in Implementation Notes, with no automated regression protection — `low`-`medium`, real: add a small test that greps `packages/core`/`apps/web` source (excluding test files and `client-config.ts` itself) for the four `CLIENT_*` names. [new test] — fixed: `apps/web/lib/client-config-boundary.test.ts`

**defer:**
- `enabledModules.projectAdmin` only affects `GET /api/permissions`'s display — nothing in `authorize.ts`, `login()`, or (the still-nonexistent) user-creation path actually consults it, so a manually-seeded `project_admin` user can log in and act regardless of the config value. Real, but explicitly out of this story's stated scope (the frozen Approach only promises the Permissions view and `layout.tsx`); a pre-existing gap since Story 1.5 first introduced `project_admin` as an ungated role value.
- `<Toaster />` and its `@niveshbook/ui` import in `layout.tsx` are not part of this story's diff — they landed via a concurrent session's own commit (`33044d4`), correctly attributed as that session's own feature, carried along only because it shares `layout.tsx`. Not this story's problem; noted here only because it appeared in the reviewed file range.

**Rejected:**
- `false` — `layout.tsx` resolves `getClientConfig()` at module-evaluation time while `route.ts` resolves it fresh per request, claimed as an inconsistent pattern risking stale branding. Env vars are fixed for the lifetime of a deployment (client identity doesn't change mid-deployment); both patterns read the same value every time. `layout.tsx`'s static `metadata` export is the standard, correct Next.js pattern for this exact case.
- `false` — claimed that Next.js "bakes in" `CLIENT_APP_NAME` at build time, contradicting `.env.example`'s "only this value changes at deploy time" framing. That phrase describes `DATABASE_URL`, not the `CLIENT_*` block — misattributed quote. The actual `CLIENT_*` comment says "resolved once in `apps/web/lib/client-config.ts`," which matches the implementation correctly.
- `false` — the AC's grep literally matches test files (`client-config.test.ts`, `layout.test.tsx`, `route.test.ts`), which set/unset these env vars to exercise the I/O Matrix. That's expected, correct test setup, not a second place client identity is resolved in product code — AD-7's intent is about product code, not tests. A tighter AC wording would require editing this story's frozen spec, out of scope for this review.
- `low`, rejected — no operator-visible log/warning when a `CLIENT_*` value fails to parse and silently falls back. No logging convention exists anywhere else in this codebase; introducing one now is a bigger design decision than a trivial patch.
- `low`, rejected — the merged JSDoc on `getPermissionsOverview` could be misread as implying `project_admin`'s state is also "never cached." Already separated by an em-dash in the actual text (`deps.projectAdminEnabled` attributed on its own line, "never cached" attributed to approvers) — reasonably clear on a careful read; purely stylistic, no functional risk.

## Verification

**Commands:**
- `pnpm --filter web test` -- expected: `client-config.ts` and updated `/api/permissions` tests pass
- `pnpm --filter @niveshbook/core test` -- expected: updated `permissions.ts` tests pass
- `pnpm typecheck` && `pnpm build` && `pnpm lint:boundaries` -- expected: clean
