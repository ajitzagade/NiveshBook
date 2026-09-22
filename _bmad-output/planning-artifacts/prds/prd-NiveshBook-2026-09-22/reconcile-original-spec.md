# Input Reconciliation: Founder's Original Spec vs. PRD + Addendum

**Input:** `nivesh_original_spec.md` (37-section founder feature spec + closing productization/UX note)
**Checked against:** `prd.md` + `addendum.md` (prd-NiveshBook-2026-09-22)

---

## Covered (brief confirmation, section by section)

- **Intro / plain-language term mapping (lines 1-21)** — Fully covered. PRD §3 Glossary defines Add Money, Should Pay, Paid Now, Extra Paid, Pending, Keep for Later, Adjust Next Time, Available Balance, Money History, Share % — matching every founder-specified plain term. PRD §0 explicitly commits to "Glossary-anchored vocabulary."
- **§1 Login and Security** — Covered: FR-1 through FR-8, §4.1. Roles, session handling, active/inactive, server-side re-verification, 403 behavior all present and match spec wording closely.
- **§2 Owner/Admin Access** — Covered, though distributed across FRs/Glossary rather than one enumerated list (Owner/Super Admin Glossary entry, FR-4, FR-35, FR-41 visibility). Not a gap, just structural. One sub-item ("Manage permissions") is weaker — see Gaps.
- **§3 Partner Privacy** — Covered thoroughly: §4.2, FR-9, FR-10, FR-11, UJ-3, matches the Partner A/B/sub-partner example almost verbatim.
- **§4 Project Creation** — Covered exactly: FR-12, "just Name and Description."
- **§5 Main Partner Percentage** — Covered exactly: FR-13, including the three validation message variants verbatim.
- **§6 Sub-partner Percentage** — Covered exactly: FR-14, "never as a percentage of the Partner's own percentage" language matches spec's stated constraint.
- **§7 Add Money/Investment Requirement** — Covered: FR-15, FR-16.
- **§8 Flexible Investment** — Covered: FR-17 (any amount, never capped, never alters Share %), FR-18.
- **§9 Adjust Investment Next Time** — Covered: FR-19, and the worked numbers (A→₹3L, B→₹3L, C→₹4L) match spec exactly.
- **§10 Sub-partner Investment Adjustment** — Covered: FR-20, private-to-partner-and-sub-partners framing matches.
- **§11-12 Withdraw Money / Flexible Withdrawal** — Covered: FR-21, FR-22, FR-23; §4.5 description explicitly states "No Available Balance entry is created unless money is actually withdrawn," matching spec's explicit instruction in §12.
- **§13 Extra Withdrawal** — Covered: FR-25, matches Extra Taken / permission-gated framing.
- **§14 Sub-partner Withdrawal** — Covered: FR-26, "does not force or block another's withdrawal" matches "Do not force all of them to withdraw together."
- **§15 What Happens After Actual Withdrawal** — Covered: FR-27, "Where did this money go?" phrase preserved verbatim in UJ-4.
- **§16 Moving Money to Another Project** — Covered: FR-28, auto-linked three-record chain, no duplicate manual entry.
- **§17 Available Balance** — Covered generally: FR-29 (running balance, increment/decrement, never negative).
- **§18 Complete Money Trail** — Covered: FR-30, SM-3.
- **§19 Record Add Money Transaction** — Covered exactly: FR-17 fields and payment-mode list match spec verbatim (Cash, Cheque, NEFT, RTGS, IMPS, UPI, Bank Transfer, Other).
- **§20 Record Withdrawal** — Covered: FR-22 + FR-27 (destination allocation as separate step).
- **§21-23 Dashboards (Simple/Partner/Sub-partner)** — Covered: FR-35, FR-36, FR-37; card sets match closely, including "My Sub-partners if allowed" (FR-36) and "no visibility into other Partners" (FR-37).
- **§24 Simple History Page** — Covered, including the tone requirement: §4.7 description states Money History is "deliberately not called a 'ledger' anywhere in the UI," directly reflecting spec's "Avoid technical terms such as General Ledger."
- **§25 Adjustment Page** — Structurally covered: FR-33 (Investment + Withdrawal sections, per-person). The "do not show complicated accounting formulas" instruction is not explicitly restated — see Gaps (bundled with §32).
- **§26 Reports** — Covered exactly: FR-38's report list matches spec's list item-for-item; FR-39 (date/project/person filtering), FR-40 (Excel/PDF export) match §26 exactly.
- **§27 Audit History** — Covered: FR-41, FR-42, "Cancel/Reverse instead of hard delete" preserved.
- **§28 Recommended Data Logic** — Covered: concept separation reflected in Glossary + FR-18/FR-34 ("independent... never mix Investment and Withdrawal Adjustment").
- **§29 Investment Calculation (formulas)** — Verified exact match. Spec: `Base Amount = Funding Requirement × Share %`; `Recommended Amount = Base Amount + Previous Pending − Previous Extra Paid`; `New Adjustment = Recommended Amount − Actual Amount` (positive→Pending, negative→Extra Paid). PRD FR-18/FR-19 and addendum's "Calculation Derivations" reproduce this formula set verbatim, no drift.
- **§30 Withdrawal Calculation (formulas)** — Verified exact match. Spec: `Base Entitlement = Withdrawal Amount × Share %`; `Recommended Available Withdrawal = Base Entitlement + Previous Keep For Later − Previous Extra Taken`; remaining→Keep for Later; over-entitlement (with permission)→Extra Taken. PRD FR-21, FR-23, FR-24, FR-25 and addendum reproduce this verbatim, no drift.
- **§31 Investment/Withdrawal Independence** — Covered explicitly, including being called out by section number: addendum's "Rejected/Deferred Scope Notes" cites "§31 of the original requirements" directly, and FR-34 states the netting rule and that any explicit offset is itself audited.
- **§34 End-to-End Journey** — Covered, though split across four UJs (UJ-1, UJ-2, UJ-3, UJ-4) rather than kept as one continuous narrative. Every numbered figure in the spec's walkthrough reappears correctly: requirement ₹10,00,000 → Should Pay 5L/3L/2L (UJ-1); actual 7L/3L/0 → Extra Paid 2L / Pending 2L (UJ-2); next-round recommended 3L/3L/4L (UJ-2); withdrawal available ₹5,00,000 → Can Take 2.5L/1.5L/1L, only A withdraws, B/C Keep for Later 1.5L/1L (UJ-4); A's ₹2.5L split 1.5L→Project B / 50k→Person X / 50k→Available Balance (UJ-4); later ₹30,000 moved from Available Balance to a third project (FR-30 Consequences, SM-3). Steps 1-3 (create project, add partner shares, validate sub-split) aren't narrated as their own UJ but are covered via FR-12/13/14.
- **§35 Privacy Test Scenario** — Covered and preserved as an explicit test requirement, not just narrative: UJ-3's edge case matches the spec almost word-for-word ("manually tries to access... via URL or API manipulation... 403 Forbidden... must not return any... private information"), and SM-2 elevates it to a success metric run "against every Partner/Sub-partner pairing," matching the spec's "also test explicitly" instruction.
- **§36 Development Quality — decimal handling only** — Covered: addendum states both calculations "must use decimal-safe arithmetic... never native floating point for money," and "Share % must support at least 2 decimal places (e.g. 33.33%)," matching spec exactly. (Other §36 items are gaps — see below.)
- **§37 Final Goal, bullets 4-7** — Covered: strict privacy (§4.2), complete money trail (FR-30), never lose adjustment history (FR-19/24, audit FR-41), never auto-change ownership % (repeated in FR-17 Consequences, Vision, UJ-2). Bullet 8 (test E2E before done) is a process directive, functionally served by SM-2/SM-3 as acceptance criteria. Bullets 1 and 3 are gaps — see below.
- **Closing note — multi-client packaging** — Covered thoroughly: PRD §4.12 (FR-43, FR-44), Non-Goals, MVP Scope, and addendum's full "Options Considered — Productization Model" section (including the explicit rejection of true multi-tenancy and why).
- **Closing note — "not AI-generated" UX** — Covered explicitly: addendum's "Design Reference Gap" section names this directly, and it's carried as PRD Open Question #1.

---

## Gaps

### 1. §32 UI/UX Requirements — the largest gap. Mostly absent from the PRD.
Only one clause made it through: Indian currency/number formatting (FR-44). Everything else in §32 is missing, with no FR, Non-Goal, NFR, or Open Question capturing it:
- Visual/interaction style: "Clean white/light interface, Clear cards, Large readable amounts, Short labels."
- Interaction patterns: "Clear confirmation messages, Simple forms, Searchable dropdowns where required, Clear icon to remove/change selected dropdown value, Simple status tags."
- The restraint list: "Avoid: Too many charts, Complicated graphs, Accounting jargon, Excessive modals, Too many fields on one screen, Complex nested tables, Technical database terminology."
- The helper-text mandate: "Important actions should always include a small example or helper text, e.g. 'Share 50% means if the project needs ₹10,00,000, your normal share is ₹5,00,000.'" This is the same instinct behind §25's "do not show complicated accounting formulas" and §37 bullets 1 ("Keep UI simple") and 3 ("Show examples wherever calculations may confuse users") — it recurs four separate times in the spec and isn't captured as an actionable requirement anywhere in the PRD, only alluded to narratively in the Vision's tone commitment (which covers *vocabulary*, not *interaction/visual restraint or worked-example UI pattern*).
- General responsiveness ("work properly on desktop, tablet, and mobile") is only implied by contrast in Non-Goals ("Not a native mobile app in v1 — responsive web only"), not stated as an affirmative, testable requirement.

**Where it should go:** A new PRD subsection (e.g. "4.13 UI/UX Design Constraints" or a dedicated NFR/Design Principles section) enumerating: the avoid-list as explicit constraints, the helper-text-with-worked-example requirement as a testable FR/consequence, responsive behavns an NFR, and the visual/interaction items as either FRs or a forwarding note to `bmad-ux`'s DESIGN.md/EXPERIENCE.md so they aren't lost between now and that stage.

### 2. §33 Main Navigation — not represented at all, even lightly.
No mention of the proposed IA (Home, Projects, Partner Shares, Add Money, Withdraw Money, Available Balance, Adjust Next Time, Money History, Reports; plus Owner/Admin-only: Users, Permissions, Audit History) anywhere in the PRD. The "don't show inaccessible menus" clause is separately covered by existing access-control FRs (FR-7/FR-8), so only the IA structure itself is missing.

**Where it should go:** Likely acceptable to defer entirely to `bmad-ux`'s EXPERIENCE.md (navigation is IA, not FR-shaped), but per the reconciliation check it should get at least a pointer — either a line in the addendum (similar to how "Deployment Mechanics" and "Design Reference Gap" forward other spec content to later stages) or an Open Question, so the raw spec's nav list doesn't need to be independently rediscovered later.

### 3. §36 Development Quality — three items missing entirely (decimal-safety is covered, see above).
"Transaction-safe financial updates," "No duplicate transactions," and "Proper loading/error/empty states" appear nowhere in the PRD or addendum — not even as a forwarding note to Architecture, unlike other implementation-level items (e.g. FR-43's deployment mechanics get an explicit addendum section). "No negative invalid balances" is only covered for the specific case of Available Balance (FR-29 Consequences), not as a general constraint across all balance types.

**Where it should go:** NFR/constraint section, or an addendum note pointing these at Architecture the same way "Deployment Mechanics" does for FR-43 — so they're flagged for that stage rather than silently dropped.

### 4. "Manage Permissions" as a distinct Owner/Admin capability — weakly captured.
Spec §2 lists "Manage permissions" as an Owner/Admin ability, and §33's nav list includes a standalone "Permissions" menu item, implying a UI/capability for granting or adjusting access beyond fixed role defaults (e.g. the FR-11 sub-partner visibility grant, the FR-25 extra-withdrawal authorization). PRD's FR-6 only defines fixed default permission sets per role — there's no FR for a unified permissions-management capability.

**Where it should go:** Either a new FR under §4.1 ("Owner/Admin can manage per-user/per-role permission grants") or an Open Question if the founder intended something narrower (e.g. just the two grant mechanisms already covered by FR-11/FR-25, in which case this is a non-issue and worth a one-line confirmation rather than a new FR).

---

## Summary

Of 37 numbered spec sections plus the closing note, 33 are fully and accurately reflected — including both calculation sections (§29, §30) verified formula-for-formula, the full end-to-end journey (§34), and the privacy test scenario (§35), all matching the spec's worked numbers exactly. The material gaps are concentrated in the qualitative/UI-restraint requirements (§32, §33, and the related bullets in §25/§37) and a few development-quality NFRs (§36), which is exactly the kind of content that erodes silently when a narrative spec is compressed into FR-shaped requirements.
