# Addendum: NiveshBook PRD

Depth that belongs to downstream work (Architecture, UX) or doesn't fit the PRD's capability-level narrative is captured here so it isn't lost.

## Options Considered — Productization Model

Two models were considered for "package this for multiple clients":

1. **Single codebase, one deployment per client, config-driven differences** (chosen, carried into PRD §4.12 as `[ASSUMPTION]`). Each client gets their own deployment and database; differences are branding, currency or locale, and enabled modules — never per-client code forks or business-rule differences.
2. **True multi-tenant SaaS** (single deployment, single database, `tenant_id` on every row). Rejected for v1: the privacy requirements in this product are already strict *within* one client (partner-vs-partner, §4.2) — stacking cross-client tenant isolation on top raises the stakes of every query (every access check becomes a two-dimensional check: tenant AND partner/sub-partner) for a scaling benefit that isn't needed yet with one real client at launch.

This should be revisited explicitly at Architecture if a near-term second or third client is confirmed and the operational cost of separate deployments (hosting, monitoring, and upgrade rollout per client) becomes material.

## Calculation Derivations

Reference only — the testable behavior itself lives in the PRD's FR Consequences (FR-18, FR-19, FR-23, FR-24); this section exists so the formulas aren't re-derived from scratch downstream.

**Investment cycle:**
```
Base Amount = Funding Requirement × Share %
Recommended Amount = Base Amount + Previous Pending − Previous Extra Paid
New Adjustment = Recommended Amount − Actual Amount
  positive → Pending
  negative → Extra Paid
```

**Withdrawal cycle:**
```
Base Entitlement = Withdrawal Amount × Share %
Recommended Available Withdrawal = Base Entitlement + Previous Keep For Later − Previous Extra Taken
Remaining = Can Take − Take Now → Keep for Later
Take Now > Can Take (with permission) → Extra Taken
```

Both computations must use decimal-safe arithmetic (fixed-point or smallest-currency-unit integer storage, or an appropriate DECIMAL database type) — never native floating point for money. Share % must support at least 2 decimal places (for example, 33.33%).

## Deployment Mechanics

Architecture concern, not PRD: FR-43 (per-client configuration layer) states the *capability* — deploy a second client via config, not code. The actual mechanism (env-based config, a config service, infra-as-code per client, and other options) is an Architecture decision. Note for that stage: the existing monorepo shape (`apps/web`, `apps/api`, `packages/core`, `packages/ui`, `packages/types`, `packages/config`) already anticipates this — `packages/core` should hold the business rules (adjustment math, privacy rules, and role model) with zero client-specific branching, and client differences should resolve to data (a config record or file), not code paths.

## Rejected or Deferred Scope Notes

- **Automated Investment and Withdrawal Adjustment netting** was considered (auto-offset Extra Paid against Keep for Later) and explicitly rejected per the original spec (§31): these are independent balances by design, and only an explicit Owner/Admin action may net them, with that action itself audited (PRD FR-34, FR-41). Do not revisit this without founder sign-off — it's a stated product principle, not an oversight.
- **Project Admin role** is marked optional in the original spec. Kept in the PRD (§4.1 FR-6) as a supported role since removing it is a bigger decision than keeping it, but flagged as Open Question #2 for explicit go/no-go before Epics.
