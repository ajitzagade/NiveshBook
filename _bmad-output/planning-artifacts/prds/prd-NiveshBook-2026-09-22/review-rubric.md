# PRD Quality Review — NiveshBook

## Overall verdict

This is an unusually rigorous fast-path PRD: the core money-math FRs carry real, numeric testable consequences, the trade-off between per-client deployment and multi-tenant SaaS is argued honestly in the addendum, and the four UJs are load-bearing rather than decorative. The reconciliation pass's two additions (§5 NFRs, §6 Aesthetic/Tone/IA) are substantive, not theater — they add genuinely new requirements (decimal-safe arithmetic, atomicity, banned-vocabulary list) rather than restating what FRs already said. What's at risk is mechanical integrity left behind by that same reconciliation pass: the FR count in §0 (46) doesn't match reality (45, non-contiguous), MVP Scope's stated range (FR-1–44) silently excludes FR-45, and the MVP Scope subsection numbers (6.1/6.2) are stale leftovers from before §5/§6 were inserted. None of these are conceptually hard to fix, but left as-is they will actively mislead Epics/Stories generation about what's in scope.

## Decision-readiness — adequate

Trade-offs are largely surfaced honestly rather than smoothed over. The productization decision (per-client deployment vs. true multi-tenant SaaS) is argued with a real cost named — "stacking cross-client tenant isolation... raises the stakes of every single query" — and a concrete trigger for revisiting it (addendum, "Options Considered"). The two counter-metrics (SM-C1, SM-C2) explicitly refuse to let UX/speed erode a safety control and an audit requirement, which is exactly what the rubric asks for and is rare to see done well. Open Questions 1, 2, and 4 are genuinely open (no answer smuggled into the next sentence); OQ3 (password reset window) is closer to a "confirm this default" item than a real open question, and OQ5 (jurisdiction/compliance) is a real gap that's honestly flagged rather than hand-waved.

### Findings
- **medium** Only one `[NOTE FOR PM]` in the whole PRD (§8.2, self-serve onboarding) — Given the productization bet (build for N clients, ship 1) and the Project Admin optionality question (OQ2), both carry real go/no-go tension that a decision-maker would want flagged inline at the point of decision, not only in Open Questions at the end. *Fix:* add `[NOTE FOR PM]` at §4.1 FR-6 pointing to OQ2, and at §4.12 pointing to the addendum's revisit trigger for the deployment model.

## Substance over theater — adequate to strong

The reconciliation-pass additions were checked specifically, as requested. **§5 Cross-Cutting NFRs is substantive**, not boilerplate: "decimal-safe storage and arithmetic... never native floating point," "resubmitting the same Add Money... does not create two records," "reject an operation that would drive a balance negative" are all product-specific and independently testable — this is not "system must be scalable/secure" filler. **§6 Aesthetic/Tone/IA is also substantive**: it names actual banned vocabulary ("no 'Capital Contribution,' 'Ledger,' 'Entitlement'"), ties worked-example copy to specific FRs (FR-16, FR-18, FR-21, FR-23), and lists concrete IA nav items rather than generic "clean, modern UI" language.

Two gaps are worth naming precisely because the section exists and mostly delivers:

### Findings
- **medium** §5 has no performance, scalability, availability, or concurrency thresholds at all (§5 "Cross-Cutting NFRs & Constraints") — Security, data-integrity, and reliability-as-presence-of-states are covered well, but there is no stated response-time bound, expected data volume, concurrent-user assumption, or uptime target anywhere in the PRD. For a system that will be relied on as the record of truth for real money, Architecture will need at least a rough envelope (e.g., partner count per project, transaction volume/year) to size the system. *Fix:* add a short "Scale & Performance" subsection to §5 with even rough `[ASSUMPTION]`-tagged bounds (e.g., expected partners/project, transactions/month) — precision isn't needed yet, but silence forces Architecture to guess.
- **low** §6's single most load-bearing claim — "must not read as generic, AI-templated" — is explicitly acknowledged as unactionable pending a visual reference (§6, Open Question 1). This is handled honestly (flagged, not asserted as done), so it's not theater, but it means SM-7 (which validates this constraint) has no criterion to validate against yet. *Fix:* no PRD-level fix needed — confirm this is genuinely blocking on Open Question 1 before `bmad-ux` starts, per the addendum's own note.

## Strategic coherence — strong

The Vision states a clear thesis — automate the percentage math and privacy boundary while keeping the vocabulary plain-English trustworthy — and the feature list follows it: privacy (§4.2) is elevated to its own feature area rather than folded into RBAC, the Adjust Next Time page (§4.8) exists specifically to make carried-forward math visible without accounting jargon, and the Money Trail features (§4.6–4.7) exist to make "no reliable trail once money moves between projects" (the Vision's stated problem) untrue. Success Metrics validate behavior, not activity: SM-1 tests comprehension, SM-2 tests privacy under adversarial conditions, SM-4 tests the "ownership never silently changes" guarantee named in the Vision's second paragraph. No DAU/MAU-style vanity metric appears. Counter-metrics are present and correctly aimed at the two places speed/UX pressure would most likely erode a safety property.

No findings — this dimension does real work and doesn't need repair.

## Done-ness clarity — strong, with one gap

The financial-critical FRs (FR-13, FR-16 through FR-30) are unusually well specified for a fast-path PRD: they carry worked numeric examples in their own Consequences bullets (e.g., FR-19's carry-forward math walks the UJ-2 numbers through to ₹3,00,000/₹3,00,000/₹4,00,000), which is exactly the "verifiable condition" bar the rubric asks for. HTTP-level behavior is specified, not implied ("returns 403... zero fields of Partner B's data present," FR-8).

### Findings
- **medium** FR-5 (Session Handling) states "Sessions expire after inactivity" with no bound — Every other timing-sensitive FR in the same feature area got a number or an `[ASSUMPTION]` tag (FR-2's reset link got `[ASSUMPTION: 30 minutes — confirm]`); FR-5's inactivity window is left completely unstated, which is the vague-adjective pattern the rubric flags ("system handles X" without a number). *Fix:* add `[ASSUMPTION: N minutes — confirm]` to FR-5, matching the treatment already given to FR-2.
- **low** Roughly half of the 45 FRs (mostly the simple-CRUD ones: FR-3, FR-6, FR-12, FR-15, FR-31–40) have no explicit Consequences bullet — For most of these the one-line description is self-evidently testable (create/edit a project, filter a report), so this isn't a defect on its own, but the inconsistency makes it hard for a downstream reader to know whether an FR without Consequences was judged "obviously testable" or simply not gotten to. *Fix:* no action needed on the FRs themselves; consider a one-line note in §0 clarifying that Consequences bullets are added only where the testable behavior isn't obvious from the FR statement.

## Scope honesty — adequate

§7 Non-Goals is concrete and specific (six explicit non-goals, not vague hand-waving), and §8.2 Out of Scope for MVP correctly separates "deferred" items from "never" items. The Assumptions Index (§11) round-trips cleanly against inline tags with one exception (see Mechanical notes). Given this is a launch-stakes, green-light-to-build PRD, the open-items density (5 Open Questions + 9 Assumptions + 1 NOTE FOR PM across 45 FRs) is proportionate — most assumptions are narrow and quickly confirmable (a timeout window, a permission scope), and only OQ1 (design reference) and OQ2 (Project Admin go/no-go) are genuinely blocking for downstream work.

No new findings beyond what's captured under Decision-readiness and Mechanical notes.

## Downstream usability — thin (mechanical integrity issue, not content issue)

The Glossary (§3) is well-built and terms are used consistently through the FRs — no drift observed in Should Pay / Extra Paid / Pending / Keep for Later / Can Take usage. UJs each have a named protagonist and resolve to specific FRs. The problem is FR numbering and scope-statement integrity, which downstream Epics/Stories generation will consume literally.

### Findings
- **high** FR count stated in §0 doesn't match reality (§0, Document Purpose) — §0 says FRs are "numbered globally (FR-1 through FR-46)," but the PRD contains 45 distinct FRs (FR-1–FR-44, plus FR-45 inserted out of sequence in §4.1), and no FR-46 exists anywhere. A downstream reader following §0 literally will look for an FR-46 that doesn't exist. *Fix:* correct §0 to state the actual count and note the non-contiguous numbering (FR-45 inserted into §4.1 after the fact).
- **high** MVP Scope's stated FR range silently excludes FR-45 (§8.1, "Everything in §4.1 through §4.12 above (FR-1 through FR-44)") — FR-45 (Owner/Admin Permissions Management) is a real, fully-specified requirement with a testable consequence, sitting inside §4.1, but the range "FR-1 through FR-44" as literally stated excludes it, and FR-45 does not appear in §8.2's Out-of-Scope list either. This is exactly the kind of silent scope gap the rubric's Scope Honesty dimension warns about, and it will directly affect what Epics/Stories generation treats as in-scope. *Fix:* update §8.1 to explicitly include FR-45, or state the FR range as non-contiguous (1–44 plus 45).

## Shape fit — strong

This is correctly shaped as a chain-top, multi-stakeholder product PRD: four named-protagonist UJs matching the four real roles (Owner, Partner, Sub-partner, Project Admin implied), no persona bloat, and a capability-spec-style Features section for the productization/config concern (§4.12) rather than forcing an artificial "client admin" UJ that assisted-onboarding v1 doesn't actually need. Downstream traceability (Realizes FR-X tags on UJs, Validates FR-X tags on Success Metrics) is present throughout, which is the right level of formality for a PRD feeding UX → Architecture → Stories next.

No findings.

## Mechanical notes

- **MVP Scope subsection numbers are stale**: §8 "MVP Scope" contains "### 6.1 In Scope" and "### 6.2 Out of Scope for MVP" — leftover numbering from before §5 (Cross-Cutting NFRs) and §6 (Aesthetic/Tone/IA) were inserted during the reconciliation pass, which pushed the old §6 (MVP Scope) to §8 without updating its subsections. This is the clearest evidence that the reconciliation pass's renumbering wasn't fully propagated — worth a full pass to confirm no other stale cross-references survived the insertion. *Fix:* renumber to 8.1/8.2.
- **Assumptions Index section mislabel**: §11 lists "§4.11 FR-2 — password reset link expiry defaulted to 30 minutes," but FR-2 is in §4.1 (Accounts, Roles & Access Control), not §4.11 (Audit History). *Fix:* correct the index entry to §4.1.
- **Assumptions Index roundtrip**: otherwise clean — all 9 inline `[ASSUMPTION]` tags (§2.2, §3, FR-2, FR-11, FR-25, §4.12, FR-44, §6, §7) have a corresponding index entry and vice versa.
- **Source-spec section references leak into PRD**: SM-3 and SM-4 cite "§34-style" and "worked examples (§34)" — these refer to section 34 of the founder's original feature spec, not a section of this PRD (which has no §34). A downstream reader unfamiliar with the source document will look for a nonexistent §34 in the PRD itself. *Fix:* rephrase as "founder feature spec §34" or inline the relevant worked example instead of citing an external section number.
- **Glossary drift**: none observed — Should Pay, Paid Now, Extra Paid, Pending, Recommended Amount, Can Take, Take Now, Keep for Later, Extra Taken, Available Balance, Money Movement, Money History, and Audit History are all used consistently across Glossary, FRs, UJs, and Success Metrics.
- **UJ protagonist naming**: all four UJs (Ravi, Partner A, Sub1, Partner A) carry a named protagonist with contextual detail inline — no floating UJs.
- **Required sections for stakes**: all present for a chain-top, launch-stakes PRD — Document Purpose, Vision, Target User (JTBD/Non-Users/UJs), Glossary, Features/FRs, Cross-Cutting NFRs, Aesthetic/Tone/IA, Non-Goals, MVP Scope, Success Metrics, Open Questions, Assumptions Index.
