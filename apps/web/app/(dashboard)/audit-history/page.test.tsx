import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { EmptyState, RowCard, Table } from "@niveshbook/ui";
import AuditHistoryPage from "./page";

const auditLogListAll = vi.fn();
const investmentListAll = vi.fn();
const withdrawalListAll = vi.fn();
const listAllUsers = vi.fn();
// `requireOwnerAdminSession` is referenced directly in the mock factory
// below, evaluated eagerly the moment "./page"'s own hoisted import chain
// resolves "@/lib/session-guard" -- `vi.hoisted()` mirrors `layout.test.tsx`'s
// identical fix.
const { requireOwnerAdminSession } = vi.hoisted(() => ({ requireOwnerAdminSession: vi.fn() }));

vi.mock("@niveshbook/db", () => ({
  createAuditLogPort: () => ({ listAll: auditLogListAll }),
  createInvestmentTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByRequirementId: vi.fn(),
    findById: vi.fn(),
    editTransaction: vi.fn(),
    findAuditLogByTransactionId: vi.fn(),
    findByReversalOfTransactionId: vi.fn(),
    cancelTransaction: vi.fn(),
    sumActiveAmountByProjectId: vi.fn(),
    listAll: investmentListAll,
  }),
  createWithdrawalTransactionPort: () => ({
    recordTransaction: vi.fn(),
    listByProjectId: vi.fn(),
    sumActiveAmountByProjectId: vi.fn(),
    findById: vi.fn(),
    editTransaction: vi.fn(),
    cancelTransaction: vi.fn(),
    findAuditLogByTransactionId: vi.fn(),
    findByReversalOfTransactionId: vi.fn(),
    listAll: withdrawalListAll,
  }),
  createUserPort: () => ({
    findUserByEmail: vi.fn(),
    findUserById: vi.fn(),
    listAllUsers,
  }),
}));

vi.mock("@/lib/session-guard", () => ({
  requireOwnerAdminSession,
}));

/** Depth-first search for the first element of `type` -- mirrors `layout.test.tsx`'s identical `findComponent` helper. */
function findComponent(node: ReactNode, type: unknown): ReactElement | undefined {
  if (node === null || node === undefined || typeof node !== "object") {
    return undefined;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findComponent(child, type);
      if (found) return found;
    }
    return undefined;
  }
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === type) {
    return element;
  }
  return findComponent(element.props?.children, type);
}

/** Every element of `type` in the tree, depth-first -- used to count the below-860px RowCard stack (spec-mobile-responsive-phase2-table-cards). */
function findAllComponents(node: ReactNode, type: unknown): ReactElement[] {
  if (node === null || node === undefined || typeof node !== "object") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((child) => findAllComponents(child, type));
  }
  const element = node as ReactElement<{ children?: ReactNode }>;
  const rest = findAllComponents(element.props?.children, type);
  return element.type === type ? [element, ...rest] : rest;
}

/** Every element whose own `className` contains `substring`, in document order -- used to assert the breakpoint wrapper divs' classNames directly (review fix: jsdom never evaluates CSS, so this is the only way to catch a swapped/dropped `max-[860px]:` class in a server-component test). */
function findAllClassNameMatches(node: ReactNode, substring: string): ReactElement[] {
  if (node === null || node === undefined || typeof node !== "object") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((child) => findAllClassNameMatches(child, substring));
  }
  const element = node as ReactElement<{ children?: ReactNode; className?: string }>;
  const rest = findAllClassNameMatches(element.props?.children, substring);
  const ownClassName = typeof element.props?.className === "string" ? element.props.className : "";
  return ownClassName.includes(substring) ? [element, ...rest] : rest;
}

describe("AuditHistoryPage (Story 5.9)", () => {
  beforeEach(() => {
    requireOwnerAdminSession.mockReset().mockResolvedValue({ id: "session-1", userId: "owner-1" });
    auditLogListAll.mockReset().mockResolvedValue([]);
    investmentListAll.mockReset().mockResolvedValue([]);
    withdrawalListAll.mockReset().mockResolvedValue([]);
    listAllUsers.mockReset().mockResolvedValue([]);
  });

  it("calls requireOwnerAdminSession -- defense in depth, independent of the nav's own role-hiding", async () => {
    await AuditHistoryPage();

    expect(requireOwnerAdminSession).toHaveBeenCalledOnce();
  });

  it("propagates a rejection from requireOwnerAdminSession (e.g. a redirect thrown for a non-owner_admin session) -- the page never renders for them", async () => {
    requireOwnerAdminSession.mockImplementation(() => {
      throw new Error("REDIRECT");
    });

    await expect(AuditHistoryPage()).rejects.toThrow("REDIRECT");
    expect(auditLogListAll).not.toHaveBeenCalled();
  });

  it("renders EmptyState when there's no in-scope audit history yet", async () => {
    const result = await AuditHistoryPage();

    expect(findComponent(result, EmptyState)).toBeDefined();
    expect(findComponent(result, Table)).toBeUndefined();
  });

  it("renders a Table row per in-scope entry, actor name resolved, entity-type-out-of-scope rows filtered out (Decision #6)", async () => {
    auditLogListAll.mockResolvedValue([
      {
        id: "audit-1",
        entityType: "investment_transaction",
        entityId: "itx-1",
        action: "edit",
        actorUserId: "owner-1",
        oldValue: { amount: "400000" },
        newValue: { amount: "500000" },
        reason: "typo'd the original amount",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "audit-2",
        entityType: "withdrawal_destination_allocation",
        entityId: "leg-1",
        action: "create",
        actorUserId: "owner-1",
        oldValue: null,
        newValue: {},
        reason: null,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    investmentListAll.mockResolvedValue([
      {
        id: "itx-1",
        requirementId: "req-1",
        projectId: "project-1",
        partyType: "partner",
        shareId: "a",
        sharePercentSnapshot: "50",
        shouldPaySnapshot: "500000",
        amount: "500000",
        transactionDate: "2026-10-01",
        paymentMode: "upi",
        referenceNumber: null,
        notes: null,
        status: "active",
        reversalOfTransactionId: null,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    listAllUsers.mockResolvedValue([
      {
        id: "owner-1",
        email: "owner@niveshbook.test",
        passwordHash: "hash",
        role: "owner_admin",
        active: true,
        canApproveExtraWithdrawal: true,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);

    const result = await AuditHistoryPage();

    const table = findComponent(result, Table);
    expect(table).toBeDefined();
    const rendered = JSON.stringify(result);
    expect(rendered).toContain("owner@niveshbook.test");
    expect(rendered).toContain("typo'd the original amount");
    // `extractAmount()`'s real output actually reaches the rendered Amount
    // cell -- the fixture's `newValue.amount` is "500000" (post-review
    // finding: this was previously never asserted against rendered output).
    expect(rendered).toContain("500000");
    // The out-of-scope `withdrawal_destination_allocation` row never appears.
    expect(rendered).not.toContain("leg-1");
    // Neither row here has since been reversed -- no "Reversed" badge yet
    // (the positive case, a row that HAS been reversed, is covered by the
    // dedicated test below).
    expect(rendered).not.toContain("Reversed");
  });

  it("renders a 'Reversed' StatusChip for a row whose transaction has since been cancelled (Decision #5's linked-reversal mechanism)", async () => {
    auditLogListAll.mockResolvedValue([
      {
        id: "audit-1",
        entityType: "investment_transaction",
        entityId: "itx-1",
        action: "create",
        actorUserId: "owner-1",
        oldValue: null,
        newValue: { amount: "500000" },
        reason: null,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    investmentListAll.mockResolvedValue([
      {
        id: "itx-1",
        requirementId: "req-1",
        projectId: "project-1",
        partyType: "partner",
        shareId: "a",
        sharePercentSnapshot: "50",
        shouldPaySnapshot: "500000",
        amount: "500000",
        transactionDate: "2026-10-01",
        paymentMode: "upi",
        referenceNumber: null,
        notes: null,
        status: "cancelled",
        reversalOfTransactionId: null,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
      {
        // The reversal row -- `assembleAuditHistory()` tags every audit-log
        // row belonging to `itx-1` (its own `entityId`), not just a
        // `"cancel"`-action row, once ANY transaction's `reversalOfTransactionId`
        // points back at it (this story's Deviation #3).
        id: "itx-1-reversal",
        requirementId: "req-1",
        projectId: "project-1",
        partyType: "partner",
        shareId: "a",
        sharePercentSnapshot: "50",
        shouldPaySnapshot: "500000",
        amount: "500000",
        transactionDate: "2026-10-01",
        paymentMode: "upi",
        referenceNumber: null,
        notes: null,
        status: "cancelled",
        reversalOfTransactionId: "itx-1",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    listAllUsers.mockResolvedValue([
      {
        id: "owner-1",
        email: "owner@niveshbook.test",
        passwordHash: "hash",
        role: "owner_admin",
        active: true,
        canApproveExtraWithdrawal: true,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);

    const result = await AuditHistoryPage();

    const rendered = JSON.stringify(result);
    expect(rendered).toContain("Reversed");
  });
});

/**
 * spec-mobile-responsive-phase2-table-cards: below 860px, every row also
 * renders as a non-interactive `RowCard` (Type as title, every other
 * column stacked as a field) alongside the unchanged Table -- both exist in
 * the DOM simultaneously, CSS-only breakpoint switch.
 */
describe("AuditHistoryPage -- below-860px RowCard stack", () => {
  beforeEach(() => {
    requireOwnerAdminSession.mockReset().mockResolvedValue({ id: "session-1", userId: "owner-1" });
    auditLogListAll.mockReset().mockResolvedValue([]);
    investmentListAll.mockReset().mockResolvedValue([]);
    withdrawalListAll.mockReset().mockResolvedValue([]);
    listAllUsers.mockReset().mockResolvedValue([]);
  });

  it("renders one RowCard per in-scope row, with every table field present on its card equivalent", async () => {
    auditLogListAll.mockResolvedValue([
      {
        id: "audit-1",
        entityType: "investment_transaction",
        entityId: "itx-1",
        action: "edit",
        actorUserId: "owner-1",
        oldValue: { amount: "400000" },
        newValue: { amount: "500000" },
        reason: "typo'd the original amount",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    investmentListAll.mockResolvedValue([
      {
        id: "itx-1",
        requirementId: "req-1",
        projectId: "project-1",
        partyType: "partner",
        shareId: "a",
        sharePercentSnapshot: "50",
        shouldPaySnapshot: "500000",
        amount: "500000",
        transactionDate: "2026-10-01",
        paymentMode: "upi",
        referenceNumber: null,
        notes: null,
        status: "active",
        reversalOfTransactionId: null,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    listAllUsers.mockResolvedValue([
      {
        id: "owner-1",
        email: "owner@niveshbook.test",
        passwordHash: "hash",
        role: "owner_admin",
        active: true,
        canApproveExtraWithdrawal: true,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);

    const result = await AuditHistoryPage();

    const cards = findAllComponents(result, RowCard);
    expect(cards).toHaveLength(1);
    const card = cards[0]?.props as {
      title: ReactNode;
      badge: ReactNode;
      fields: { label: string; value: ReactNode }[];
    };
    expect(card.title).toBe("Add Money");
    // Mirrors the desktop table's own "—" fallback for the Linked column
    // when there's no reversal (review fix: no silent data loss between
    // the two renders -- a `null` badge would render nothing at all).
    expect((card.badge as ReactElement).props).toMatchObject({ children: "—" });
    expect(card.fields.map((field) => field.label)).toEqual(["Date", "Action", "Actor", "Amount", "Reason"]);
    expect(card.fields.find((field) => field.label === "Actor")?.value).toBe("owner@niveshbook.test");
    expect(card.fields.find((field) => field.label === "Reason")?.value).toBe("typo'd the original amount");
  });

  it("renders the 'Reversed' badge on the card for a row whose transaction has since been cancelled (mirrors the desktop 'renders a Reversed StatusChip' test -- verified via the card's own `badge` prop, not just JSON.stringify(result) which the always-present desktop <Td> alone would already satisfy)", async () => {
    auditLogListAll.mockResolvedValue([
      {
        id: "audit-1",
        entityType: "investment_transaction",
        entityId: "itx-1",
        action: "create",
        actorUserId: "owner-1",
        oldValue: null,
        newValue: { amount: "500000" },
        reason: null,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    investmentListAll.mockResolvedValue([
      {
        id: "itx-1",
        requirementId: "req-1",
        projectId: "project-1",
        partyType: "partner",
        shareId: "a",
        sharePercentSnapshot: "50",
        shouldPaySnapshot: "500000",
        amount: "500000",
        transactionDate: "2026-10-01",
        paymentMode: "upi",
        referenceNumber: null,
        notes: null,
        status: "cancelled",
        reversalOfTransactionId: null,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "itx-1-reversal",
        requirementId: "req-1",
        projectId: "project-1",
        partyType: "partner",
        shareId: "a",
        sharePercentSnapshot: "50",
        shouldPaySnapshot: "500000",
        amount: "500000",
        transactionDate: "2026-10-01",
        paymentMode: "upi",
        referenceNumber: null,
        notes: null,
        status: "cancelled",
        reversalOfTransactionId: "itx-1",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    listAllUsers.mockResolvedValue([
      {
        id: "owner-1",
        email: "owner@niveshbook.test",
        passwordHash: "hash",
        role: "owner_admin",
        active: true,
        canApproveExtraWithdrawal: true,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);

    const result = await AuditHistoryPage();

    const cards = findAllComponents(result, RowCard);
    const reversedCard = cards.find((card) => (card.props as { title: ReactNode }).title === "Add Money");
    expect(reversedCard).toBeDefined();
    const badge = (reversedCard?.props as { badge: ReactElement }).badge;
    expect(badge.props).toMatchObject({ variant: "danger", children: "Reversed" });
  });

  it("renders no card stack in the empty state (EmptyState renders once, not duplicated for table+card)", async () => {
    const result = await AuditHistoryPage();

    expect(findAllComponents(result, RowCard)).toHaveLength(0);
  });

  // Review fix: jsdom never evaluates CSS, so a swapped/dropped breakpoint
  // class would still leave every other assertion above green. Assert the
  // actual wiring directly, mirroring layout.test.tsx's `asideClassName`
  // pattern (this page is a server component, so the check walks the
  // returned element tree rather than a rendered DOM).
  it("wires the desktop Table and mobile RowCard stack to opposite ends of the 860px breakpoint", async () => {
    auditLogListAll.mockResolvedValue([
      {
        id: "audit-1",
        entityType: "investment_transaction",
        entityId: "itx-1",
        action: "edit",
        actorUserId: "owner-1",
        oldValue: { amount: "400000" },
        newValue: { amount: "500000" },
        reason: null,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    investmentListAll.mockResolvedValue([
      {
        id: "itx-1",
        requirementId: "req-1",
        projectId: "project-1",
        partyType: "partner",
        shareId: "a",
        sharePercentSnapshot: "50",
        shouldPaySnapshot: "500000",
        amount: "500000",
        transactionDate: "2026-10-01",
        paymentMode: "upi",
        referenceNumber: null,
        notes: null,
        status: "active",
        reversalOfTransactionId: null,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    listAllUsers.mockResolvedValue([
      {
        id: "owner-1",
        email: "owner@niveshbook.test",
        passwordHash: "hash",
        role: "owner_admin",
        active: true,
        canApproveExtraWithdrawal: true,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);

    const result = await AuditHistoryPage();

    const [tableWrapper, cardWrapper] = findAllClassNameMatches(result, "860px") as ReactElement<{
      className: string;
    }>[];
    expect(tableWrapper?.props.className).toContain("max-[860px]:hidden");
    expect(cardWrapper?.props.className).toContain("hidden");
    expect(cardWrapper?.props.className).toContain("max-[860px]:block");
  });
});
