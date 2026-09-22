---
title: Product Brief - NiveshBook
status: ready
created: 2026-09-22
updated: 2026-09-22
---

# Product Brief: NiveshBook

## Executive Summary

NiveshBook is a web application for tracking money — investments, withdrawals, balances, and transfers — across multiple projects owned jointly by partners and sub-partners. It replaces the spreadsheet-and-WhatsApp method most small partnership businesses (real estate, joint ventures, family investment groups) use today, where percentage math, who-owes-what, and who-can-see-what are worked out by hand and trusted on faith.

The product's defining constraint is plain language: partners and sub-partners are often not comfortable with financial or accounting jargon, so every screen uses everyday words (Add Money, Should Pay, Extra Paid, Keep for Later) instead of accounting terms (Capital Contribution, Contribution Deficit, Carry Forward Adjustment). Underneath the simple language sits a strict, backend-enforced privacy model — each partner's internal sub-partner structure and adjustment history are private even from co-partners in the same project — and a complete, auditable money trail from the moment money enters a project to wherever it eventually ends up.

NiveshBook is built as a **product**, not a one-off app: a single core codebase that can be deployed and configured for multiple client businesses, each with their own projects, partners, and branding, without forking the code per client.

> **Two items below need your sign-off before next-phase work begins:** [Productization Approach](#productization-approach-flagged-assumption--confirm-before-architecture) and [Design & Feel](#design--feel-flagged-assumption--confirm-before-ux-work) are flagged assumptions, not decisions.

## The Problem

Partnership-based investment groups — a few people jointly funding real estate or similar projects, often with each partner further splitting their own share among sub-partners — currently track this money in spreadsheets, notebooks, or scattered chat threads.

Concretely, that breaks down in predictable ways:
- **Percentage math done by hand, redone every cycle.** Every time a project needs money, someone recalculates who owes what based on shares, then separately tracks who actually paid what, then manually carries forward the difference to the next round. This is exactly the kind of repetitive arithmetic that produces silent errors nobody catches until months later.
- **No real privacy boundary.** In a spreadsheet or shared document, if Partner A splits their share with two sub-partners, Partner B usually either sees that internal split too (privacy leak) or has to be kept on a separate, manually-maintained spreadsheet (extra work, and one slip-up away from a leak).
- **Money movement between projects is untraceable.** When money is withdrawn from one project and reinvested in another, or split across a project, a person, and money set aside for later, spreadsheets don't naturally preserve that thread — so "where did this ₹5,00,000 actually end up?" becomes a manual reconstruction exercise.
- **Trust erodes without a shared, tamper-evident record.** Partners are trusting each other's arithmetic and honesty. A wrong number, once entered, is often just overwritten — leaving no record that anything changed, by whom, or why.
- **Jargon excludes people.** Many partners and sub-partners are not fluent in accounting language, so tools built with standard financial terminology (contribution, entitlement, carry-forward adjustment) are intimidating or simply not used, pushing everyone back to informal tracking.

The cost of the status quo isn't just inconvenience — it's disputes between partners over who paid what, money that's hard to account for after it moves between projects, and a system that only the most numerate person in the group can actually maintain.

## The Solution

NiveshBook gives each project a single source of truth for money in, money out, and where it went — expressed entirely in plain language, with the underlying percentage math, adjustment carry-forward, and privacy rules handled automatically by the system rather than by hand.

The core journey the product makes easy:
**Project → Partner Share % → Money Needed → Should Pay / Paid Now → Adjust Next Time → Withdraw Money → Keep for Later → Move Money → Available Balance → Invest Again → Money History.**

Along that journey, the product's job is to:
- Turn a project's funding requirement and each partner's Share % into a plain "Should Pay" number, automatically — including one level down, for a partner's private sub-partners, without asking anyone to compute nested percentages.
- Let actual payments and withdrawals be anything (more, less, zero) without ever changing anyone's ownership %, and automatically remember and carry forward the difference ("Extra Paid" / "Pending" / "Keep for Later") into the next cycle as a *recommended*, not forced, adjustment.
- Enforce partner and sub-partner privacy at the data-access layer, not by hiding UI elements — so Partner B's internal split and balances are structurally invisible to Partner A regardless of what URL or ID they attempt to use.
- Keep every rupee traceable: when withdrawn money is split across another project, a person, and money kept for later, that split is permanently linked back to its source withdrawal, so the full trail can always be reconstructed.
- Preserve history instead of overwriting it — edits and corrections are recorded (who, when, old value, new value), and transactions are cancelled/reversed rather than deleted.

## What Makes This Different

The honest differentiator here is not a novel algorithm — the underlying math (share-based allocation, carry-forward adjustment) is standard partnership accounting. What's different is the combination:

1. **Jargon-free by design, not as a coat of paint.** The plain-language vocabulary (Should Pay, Extra Paid, Keep for Later) is a first-class product requirement, not a UI skin over accounting terms — it shapes the data model and the copy throughout, so a partner who has never used a financial tool can use this one.
2. **Privacy as an architecture decision, enforced server-side.** Nested partner/sub-partner privacy — where co-partners in the *same* project must not see each other's internal structure — is uncommon in off-the-shelf tools, and it has to hold even against a partner deliberately trying to access another partner's data by guessing IDs. This is treated as security, not a display filter.
3. **Flexible without losing the thread.** Most simple tools either force exact percentage-matched payments or lose track of who's ahead or behind. NiveshBook explicitly allows real-world messiness (pay late, pay extra, skip a round, withdraw partially) while always knowing precisely who owes or is owed what — and showing it plainly.
4. **Deployable as a product, not just an app.** Built from day one as a reusable core with per-client configuration, so it can be handed to a second, third, and fourth client business without rewriting it each time.

The moat is execution: getting plain language, privacy enforcement, and flexible-adjustment math right at once — and packaging it as repeatable across clients, not bespoke per customer.

## Who This Serves

**Primary users:**
- **Owner / Super Admin** — typically the person or people running the overall business (for example, a real estate developer's principal), who create projects, set up partners, and need a single clear view across everything without doing the percentage math themselves.
- **Partner** — someone with a direct share in a project. Needs to see their own numbers clearly (their share, what they should pay, what they've paid, what they can withdraw) and trust that their own private sub-partner arrangement isn't visible to co-partners.
- **Sub-partner** — someone with a share *inside* a partner's allocation. Needs the same clarity as a partner, scoped to just their own slice, with no visibility into people or numbers outside that.

**Secondary user:**
- **Project Admin** (optional role) — someone the Owner delegates day-to-day project data entry to, without giving them full Owner-level visibility across all projects.

## Success Criteria

- A brand-new partner or sub-partner, with no accounting background, can look at their dashboard and correctly state what they owe or can withdraw without asking anyone to explain it.
- Every rupee that moves — investment, withdrawal, transfer between projects, money kept for later — can be traced end-to-end through Money History, matching the full multi-step scenario worked out for this product (funding a project, partial withdrawal, splitting the withdrawal across another project, a person, and Available Balance, then re-investing from Available Balance) exactly.
- A partner cannot access another partner's or sub-partner's private data through any combination of URL or ID manipulation; every such attempt returns 403 with no data leakage — the explicit privacy test scenario for this product passes in full.
- Ownership percentages never change automatically as a side effect of investment or withdrawal flexibility — verified across the adjustment scenarios described in this brief.
- No financial transaction is ever hard-deleted; every edit preserves a before/after audit record.
- The product can be configured and deployed for a second client (different projects, partners, branding, currency, locale) without code changes specific to that client — validating the "package, not one-off app" goal.
- The interface reads as deliberately designed and polished — not as a generic, templated scaffold — confirmed by user reaction during UX review, not just a design-system checklist.

## Scope

**In for v1 (core product):**
- Login and roles (Owner, Partner, Sub-partner, optional Project Admin), forgot-password and password-reset flows, active/inactive users, session handling, full backend-enforced role, project, partner, and sub-partner access control.
- Project creation (name and description only), separate Partner Shares setup with 100% validation, and one level of sub-partner allocation (percentage of full project, with validation against the parent partner's total).
- Investment requirement creation, automatic Should-Pay calculation, flexible Paid-Now entry, automatic Extra Paid or Pending tracking carried forward as a recommended (not forced) adjustment across cycles — for partners and, privately, for their sub-partners.
- Withdrawal against available project balance with the same flexible carry-forward pattern (Keep for Later, Extra Taken with permission), and post-withdrawal destination allocation (another project, a person, Available Balance, other) with linked, traceable records.
- Available Balance tracking, including moving balance into another project later.
- Money History, a simple Adjust Next Time page, role-scoped dashboards, permission-based reports with filtering and export, and full audit history with cancel or reverse instead of delete.
- The per-client configuration layer needed to deploy a second client instance (branding, currency, locale, enabled modules) — even if only one real client exists at launch.

**Explicitly out for v1** *(flag if any of these are actually needed sooner — treated as open, not decided)*:
- Self-serve client onboarding or signup (v1 onboarding is assisted, done manually by the product owner).
- More than one level of sub-partner nesting (sub-partner-of-a-sub-partner).
- Automated payment collection or payment-gateway integration (the app *records* payment modes like UPI/NEFT; it doesn't process payments).
- Mobile native apps (v1 is responsive web only).
- Multi-tenant single-database SaaS (v1 is one deployment per client, per the packaging assumption below).

## Productization Approach *(flagged assumption — confirm before Architecture)*

Beyond the individual end users above, NiveshBook has a secondary "customer": businesses (real estate developers, joint-venture groups, family investment offices) who adopt it as their internal tool — and, per the productization goal below, additional client businesses who license or deploy their own configured instance later.

[ASSUMPTION] NiveshBook ships as a single core codebase (mirroring the existing `packages/core` / `apps/web` / `apps/api` monorepo shape) with a **per-client configuration layer** — labels, currency, locale, branding, and which modules are enabled — and **one dedicated deployment per client** rather than a shared multi-tenant database. Business rules (the adjustment math, privacy model, role structure) are assumed to be the same across all clients; only presentation and configuration vary. Client onboarding in v1 is assisted (the product owner's team sets up a new client's deployment and configuration), not self-serve.

This assumption should be pressure-tested at the PRD/Architecture stage: if any near-term client is known to need genuinely different business rules (not just different labels or currency), that changes this from a config-driven product into a customizable toolkit, which has real architectural consequences.

## Design & Feel *(flagged assumption — confirm before UX work)*

[ASSUMPTION] Beyond "clean, simple, responsive," the product must feel deliberately and distinctively designed — smooth interactions, considered typography and spacing, a fresh visual identity per the branding needs of each client — and specifically must **not** read as a generic, default-component, templated interface. This is treated as a real product constraint carried into the UX brief and architecture (for example, a proper design system in `packages/ui`, not default framework styling), not just a preference to raise during visual QA.

## Vision

If NiveshBook succeeds, it becomes the standard internal tool for small-to-mid-size partnership investment businesses — starting with the founding client's own real estate or investment projects, then repeatable enough that a second, third, and further client business can be onboarded as a configured deployment in days, not a rebuild. Two to three years out, the product line is less "an app" and more "the plain-English money ledger every partnership-run project business plugs into" — with the privacy model and flexible-adjustment logic in `packages/core` as its durable, hard-to-copy core, and the interface polish as what makes each client's partners actually want to use it instead of falling back to a spreadsheet.
