# Input Reconciliation: Product Brief → PRD

**Input:** `briefs/brief-NiveshBook-2026-09-22/brief.md`
**Checked against:** `prds/prd-NiveshBook-2026-09-22/prd.md` + `addendum.md`

---

## Covered (brief substance confirmed present in PRD)

### Executive Summary
- Plain-language constraint, backend-enforced privacy, auditable money trail, "product not app" framing — all present in PRD §0 (Document Purpose) and §1 (Vision).

### The Problem
- Percentage math done by hand → PRD §1 Vision, FR-16.
- No real privacy boundary → PRD §4.2 (FR-9, FR-10), UJ-3.
- Untraceable money movement between projects → PRD §4.6 (FR-27–FR-30).
- Trust erosion / no tamper-evident record → PRD §4.11 (FR-41, FR-42).
- Jargon excludes people → PRD §0 vocabulary framing; §4.7 explicitly avoids the word "ledger" in UI.

### The Solution
- Full core journey (Project → Share % → Should Pay → Adjust Next Time → Withdraw → Keep for Later → Move Money → Available Balance → Invest Again → Money History) is not restated as one flow diagram, but every step maps to a specific FR: FR-12/13 (Project/Share%), FR-16/17 (Should Pay/Paid Now), FR-33 (Adjust Next Time), FR-21/22 (Withdraw), FR-23 (Keep for Later), FR-27/28 (Move Money), FR-29 (Available Balance), FR-28 (auto-linked reinvestment), FR-31 (Money History). Substance is fully present.

### What Makes This Different
- **Privacy as architecture, enforced server-side** — strongly and explicitly present: FR-7, FR-8, FR-9, FR-10, UJ-3, SM-2. This is the best-represented differentiator in the PRD.
- **Flexible without losing the thread** — present: FR-17 through FR-26 (Paid Now/Take Now any amount, Extra Paid/Pending/Keep for Later/Extra Taken, carry-forward logic), UJ-2.
- **Deployable as a product** — present: §4.12 (FR-43, FR-44), SM-4, Addendum "Options Considered — Productization Model."

### Who This Serves
- Owner/Super Admin, Partner, Sub-partner, Project Admin (secondary) — all four map cleanly to PRD §2.1 Jobs To Be Done with matching framing.

### Scope
- Every "In for v1" item (login/roles, forgot-password, active/inactive, sessions, project creation, partner shares w/ 100% validation, one-level sub-partner, investment/withdrawal flows, available balance, money history, Adjust Next Time, dashboards, reports w/ export, audit history, per-client config layer) maps to specific FRs (FR-1 through FR-44).
- Every "Explicitly out for v1" item (self-serve onboarding, >1 sub-partner level, payment gateway integration, mobile native, multi-tenant SaaS) is carried into PRD §5 Non-Goals and §6.2 Out of Scope, consistently.

### Productization Approach (flagged assumption)
- Carried forward correctly and consistently tagged: `[ASSUMPTION]` in §4.12 feature description, in §5 Non-Goals, and listed in §9 Assumptions Index with an explicit pointer back to the brief ("carried from the Product Brief's flagged Productization Approach assumption"). Addendum adds the rejected-alternative reasoning (true multi-tenant SaaS) that the brief didn't need to include. This is the model example of how a flagged assumption should be threaded through a PRD — not silently hardened into fact anywhere.

---

## Gaps

### 1. Design & Feel flagged assumption — not tagged, not indexed, not a requirement (highest priority)
**Brief section:** Design & Feel *(flagged assumption — confirm before UX work)*
**What's missing:** The brief explicitly flags this as one of only two assumptions needing sign-off before downstream work, on par with Productization Approach, and says it "must be carried into the UX brief and architecture... not just a preference to raise during visual QA." In the PRD, this same idea appears only as:
- Open Question #1 ("What visual/design reference should Sally aim for on 'not generic/AI-templated'?"), and
- Addendum's "Design Reference Gap" note.

Neither location uses an `[ASSUMPTION]` tag, and — unlike Productization Approach — it is **not listed in §9 Assumptions Index** at all. There is also no FR or NFR anywhere in §4 that states "the interface must not read as generic/templated" as a testable requirement; it exists only as an unresolved question. This is exactly the kind of qualitative, load-bearing idea the FR structure tends to drop silently, and here it has.
**Where it should probably go:** Add an `[ASSUMPTION]` tag to Open Question #1 (or promote it to a short NFR/Design Constraint in §4 or a new §4.x "Interface Quality" note), and add a corresponding entry to §9 Assumptions Index mirroring how the Productization Approach assumption was carried forward.

### 2. Brief's design-quality Success Criterion has no PRD Success Metric
**Brief section:** Success Criteria — "The interface reads as deliberately designed and polished... confirmed by user reaction during UX review, not just a design-system checklist."
**What's missing:** §7 Success Metrics (SM-1 through SM-4, plus counter-metrics) has no metric validating this. It surfaces only indirectly via Open Question #1.
**Where it should probably go:** Add an SM-5 (or secondary metric) along the lines of "UX review confirms the interface is perceived as distinctively designed, not generic/templated" — tying back to whatever design reference gets resolved per Open Question #1. This is directly linked to Gap #1 above; fixing both together makes sense.

### 3. "Jargon-free by design" differentiator lacks a testable FR/NFR
**Brief section:** What Makes This Different, item 1 — "a first-class product requirement, not a UI skin... shapes the data model and the copy throughout."
**What's missing:** The PRD reflects this in prose (§0 Document Purpose, the Glossary itself, and the one explicit example in §4.7 of avoiding the word "ledger") but there is no general FR/NFR making plain-language-only copy a testable, enforceable requirement across all UI text (error messages, report labels, exports, etc.). As written, it's an editorial convention the PRD follows, not a requirement downstream work is obligated to verify.
**Where it should probably go:** Either a short NFR in §4 (e.g., "All user-facing copy — labels, errors, exports, reports — uses Glossary terms exclusively; no accounting jargon is exposed to end users") or an explicit note added to SM-1, since SM-1's usability check is the natural place to also validate vocabulary comprehension, not just numeric correctness.

### 4. Success Criterion "ownership % never changes automatically" isn't a Success Metric
**Brief section:** Success Criteria — "Ownership percentages never change automatically as a side effect of investment or withdrawal flexibility — verified across the adjustment scenarios described in this brief."
**What's missing:** This is testable via FR consequences (FR-13, FR-17: "Recording a payment never alters the person's Share %") but, unlike the brief where it sits as a peer to the privacy and traceability criteria (which did become SM-2/SM-3), it has no corresponding entry in §7 Success Metrics.
**Where it should probably go:** Add as an SM (or fold into SM-1's validation list) referencing FR-13/FR-17/FR-19/FR-23/FR-24, so it's tracked with the same rigor as the other brief success criteria.

### 5. Success Criterion "no transaction ever hard-deleted" is only a counter-metric, not a positive one
**Brief section:** Success Criteria — "No financial transaction is ever hard-deleted; every edit preserves a before/after audit record."
**What's missing:** PRD §7 only has SM-C2, a counter-metric guarding against weakening audit capture for speed — there's no primary/secondary SM that positively confirms the audit trail (FR-41, FR-42) exists and works as specified.
**Where it should probably go:** Add a positive SM validating FR-41/FR-42 directly (e.g., "100% of edits to financial transactions produce a retrievable before/after audit record; 0% of transactions are hard-deletable through any code path"), keeping SM-C2 as the separate counter-metric it already is.

### 6. Vision's "interface polish as durable differentiator" thread is dropped
**Brief section:** Vision — "...the privacy model and flexible-adjustment logic in `packages/core` as its durable, hard-to-copy core, and the interface polish as what makes each client's partners actually want to use it instead of falling back to a spreadsheet."
**What's missing:** PRD §1 Vision carries forward the `packages/core` / durable-core idea but drops the second half — interface polish as a co-equal differentiator that keeps users off spreadsheets. Consistent with Gaps #1 and #2; same root cause (Design & Feel under-weighted relative to the other flagged assumption).
**Where it should probably go:** One sentence added to PRD §1 Vision restoring the "interface polish keeps partners from reverting to spreadsheets" framing, once Gap #1 is resolved.

---

## Summary Assessment

Functional substance (roles, privacy, adjustment math, money trail, productization) is thoroughly and often more rigorously reflected in the PRD than in the brief — the FR/consequence structure served that material well. The qualitative side — plain-language-as-requirement and especially the Design & Feel flagged assumption — is the material that thinned out in the FR-centric structure, exactly as the brief itself warned it should not ("not just a preference to raise during visual QA"). The Design & Feel gap (items 1, 2, 6 above) is the one cluster worth fixing before this PRD is finalized, since the brief singled it out for explicit sign-off alongside Productization Approach, and only Productization Approach got the full assumption-tracking treatment.
