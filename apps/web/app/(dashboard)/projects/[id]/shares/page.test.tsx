// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PartnerShare, SubPartnerShare } from "@niveshbook/types";
import type { Percent } from "@niveshbook/types";
import SharesPage from "./page";

/**
 * Scoped hierarchy-rendering coverage for the founder-approved hybrid
 * (spec-partner-hierarchy-cards, 2026-09-26): this page's full PersonCard/
 * nesting rewrite previously had zero `pnpm test` coverage (no page.test.tsx
 * existed, and the Playwright spec is excluded from CI). Mirrors
 * add-money/withdraw-money page.test.tsx's mocking pattern. Not full-page
 * coverage -- just proving the partner/sub-partner containment + tint.
 */

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "project-1" }),
}));

const listPartnerShares = vi.fn();
const addPartnerShare = vi.fn();
const updatePartnerShare = vi.fn();

vi.mock("@/lib/partner-shares", () => ({
  listPartnerShares: (...args: unknown[]) => listPartnerShares(...args),
  addPartnerShare: (...args: unknown[]) => addPartnerShare(...args),
  updatePartnerShare: (...args: unknown[]) => updatePartnerShare(...args),
}));

const listSubPartnerShares = vi.fn();
const addSubPartnerShare = vi.fn();
const updateSubPartnerShare = vi.fn();

vi.mock("@/lib/subpartner-shares", () => ({
  listSubPartnerShares: (...args: unknown[]) => listSubPartnerShares(...args),
  addSubPartnerShare: (...args: unknown[]) => addSubPartnerShare(...args),
  updateSubPartnerShare: (...args: unknown[]) => updateSubPartnerShare(...args),
}));

const listUsers = vi.fn();
const createUserAccount = vi.fn();
vi.mock("@/lib/users", () => ({
  listUsers: (...args: unknown[]) => listUsers(...args),
  createUserAccount: (...args: unknown[]) => createUserAccount(...args),
  generatePassword: () => "Gener4ted!Pass",
}));

const PARTNER: PartnerShare = {
  id: "ps-1",
  partnerId: "partner-a",
  projectId: "project-1",
  name: "Partner A",
  sharePercent: "60" as Percent,
  userId: null,
  subPartnerVisibilityGrant: false,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const SUB_PARTNER: SubPartnerShare = {
  id: "sps-1",
  subPartnerId: "sub-1",
  partnerId: "partner-a",
  projectId: "project-1",
  name: "Sub One",
  sharePercent: "30" as Percent,
  userId: null,
  effectiveFrom: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  listPartnerShares.mockReset().mockResolvedValue({ shares: [PARTNER], total: "60" });
  addPartnerShare.mockReset();
  updatePartnerShare.mockReset();
  listSubPartnerShares.mockReset().mockResolvedValue({ shares: [SUB_PARTNER], total: "30" });
  addSubPartnerShare.mockReset();
  updateSubPartnerShare.mockReset();
  listUsers.mockReset().mockResolvedValue([]);
  createUserAccount.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SharesPage hierarchy rendering (spec-partner-hierarchy-cards, 2026-09-26)", () => {
  it("nests a violet sub-partner card inside the teal partner card behind the rail, once expanded", async () => {
    const user = userEvent.setup();
    render(<SharesPage />);

    await screen.findByText("Partner A");
    await user.click(screen.getByRole("button", { name: /Sub-partners/ }));
    await screen.findByText("Sub One");

    const partnerCard = screen.getByText("Partner A").closest(".nb-person-card") as HTMLElement;
    const subCard = screen.getByText("Sub One").closest(".nb-person-card") as HTMLElement;

    expect(partnerCard.className).toContain("nb-person-card-partner");
    expect(subCard.className).toContain("nb-person-card-sub");
    expect(partnerCard.contains(subCard)).toBe(true);
    expect(subCard.parentElement?.className).toContain("nb-person-nest");
  });

  it("shows the just-added Sub-partner in the still-expanded panel, not the pre-add empty state (uat-rareearth finding)", async () => {
    listSubPartnerShares.mockReset();
    listSubPartnerShares.mockResolvedValueOnce({ shares: [], total: "0" });
    const user = userEvent.setup();
    render(<SharesPage />);

    await screen.findByText("Partner A");
    await user.click(screen.getByRole("button", { name: /Sub-partners/ }));
    await screen.findByText("No Sub-partners yet for Partner A.");

    listSubPartnerShares.mockResolvedValueOnce({ shares: [SUB_PARTNER], total: "30" });
    addSubPartnerShare.mockResolvedValueOnce(SUB_PARTNER);

    await user.click(screen.getByRole("button", { name: "Add Sub-partner" }));
    await user.type(screen.getByLabelText("Name"), "Sub One");
    await user.type(screen.getByLabelText("Share %"), "30");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Sub One");
    expect(screen.queryByText("No Sub-partners yet for Partner A.")).not.toBeInTheDocument();
  });

  it("a slow eager-prefetch resolving AFTER an add does not clobber the just-added row", async () => {
    listSubPartnerShares.mockReset();
    let resolveEagerPrefetch!: (value: { shares: SubPartnerShare[]; total: string }) => void;
    const eagerPrefetch = new Promise<{ shares: SubPartnerShare[]; total: string }>((resolve) => {
      resolveEagerPrefetch = resolve;
    });
    // 1st call: the mount-time eager-prefetch effect -- held open deliberately.
    listSubPartnerShares.mockImplementationOnce(() => eagerPrefetch);
    const user = userEvent.setup();
    render(<SharesPage />);
    await screen.findByText("Partner A");

    // 2nd call: toggleExpanded's own refreshSubShares, since the eager
    // prefetch above hasn't resolved yet (subSharesByPartner[partnerId] is
    // still undefined at click time).
    listSubPartnerShares.mockResolvedValueOnce({ shares: [], total: "0" });
    await user.click(screen.getByRole("button", { name: /Sub-partners/ }));
    await screen.findByText("No Sub-partners yet for Partner A.");

    // 3rd call: the post-add refresh.
    listSubPartnerShares.mockResolvedValueOnce({ shares: [SUB_PARTNER], total: "30" });
    addSubPartnerShare.mockResolvedValueOnce(SUB_PARTNER);
    await user.click(screen.getByRole("button", { name: "Add Sub-partner" }));
    await user.type(screen.getByLabelText("Name"), "Sub One");
    await user.type(screen.getByLabelText("Share %"), "30");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Sub One");

    // Now let the stale 1st call finally resolve with its pre-add snapshot.
    resolveEagerPrefetch({ shares: [], total: "0" });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText("Sub One")).toBeInTheDocument();
    expect(screen.queryByText("No Sub-partners yet for Partner A.")).not.toBeInTheDocument();
  });

  it("a SECOND Add Sub-partner on the same still-expanded panel also refreshes correctly", async () => {
    listSubPartnerShares.mockReset();
    listSubPartnerShares.mockResolvedValueOnce({ shares: [], total: "0" });
    const user = userEvent.setup();
    render(<SharesPage />);
    await screen.findByText("Partner A");
    await user.click(screen.getByRole("button", { name: /Sub-partners/ }));
    await screen.findByText("No Sub-partners yet for Partner A.");

    const subOne: SubPartnerShare = { ...SUB_PARTNER, subPartnerId: "sub-1", name: "Sub One", sharePercent: "30" as Percent };
    const subTwo: SubPartnerShare = { ...SUB_PARTNER, subPartnerId: "sub-2", name: "Sub Two", sharePercent: "20" as Percent };

    listSubPartnerShares.mockResolvedValueOnce({ shares: [subOne], total: "30" });
    addSubPartnerShare.mockResolvedValueOnce(subOne);
    await user.click(screen.getByRole("button", { name: "Add Sub-partner" }));
    await user.type(screen.getByLabelText("Name"), "Sub One");
    await user.type(screen.getByLabelText("Share %"), "30");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Sub One");

    listSubPartnerShares.mockResolvedValueOnce({ shares: [subOne, subTwo], total: "50" });
    addSubPartnerShare.mockResolvedValueOnce(subTwo);
    await user.click(screen.getByRole("button", { name: "Add Sub-partner" }));
    await user.type(screen.getByLabelText("Name"), "Sub Two");
    await user.type(screen.getByLabelText("Share %"), "20");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Sub Two");
    expect(screen.queryByText("Sub One")).toBeInTheDocument();
  });
});

function makeUser(overrides: Partial<{ id: string; email: string; role: string; active: boolean }> = {}) {
  return {
    id: "user-partner-1",
    email: "existing-partner@example.com",
    role: "partner",
    active: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * spec-quick-add-user-share-dialog: the Add/Edit Partner and Add/Edit
 * Sub-partner dialogs' "Linked user" field -- a role-filtered searchable
 * `Combobox` (replacing the old free-text "Linked user (email)" `<Input>`,
 * which this page's own pre-existing test suite above never covered) plus
 * an inline "+ Add New User" quick-create.
 */
describe("SharesPage — Linked-user Combobox (spec-quick-add-user-share-dialog)", () => {
  it("the existing-user list is filtered to partner-role + active for the Add Partner dialog", async () => {
    listUsers.mockResolvedValue([
      makeUser({ id: "u-partner", email: "partner@example.com", role: "partner", active: true }),
      makeUser({ id: "u-sub", email: "sub@example.com", role: "sub_partner", active: true }),
      makeUser({ id: "u-inactive", email: "inactive@example.com", role: "partner", active: false }),
    ]);
    render(<SharesPage />);

    await screen.findByText("Partner A");
    await userEvent.click(screen.getByRole("button", { name: "Add Partner" }));
    await userEvent.click(await screen.findByLabelText("Linked user"));

    expect(await screen.findByText("partner@example.com")).toBeInTheDocument();
    expect(screen.queryByText("sub@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("inactive@example.com")).not.toBeInTheDocument();
  });

  it("an already-linked-but-now-inactive user still appears, pre-selected, when editing", async () => {
    listPartnerShares.mockResolvedValue({
      shares: [{ ...PARTNER, userId: "u-inactive" }],
      total: "60",
    });
    listUsers.mockResolvedValue([makeUser({ id: "u-inactive", email: "inactive@example.com", active: false })]);
    render(<SharesPage />);

    await screen.findByText("Partner A");
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    await screen.findByText("Edit Partner");

    const trigger = await screen.findByLabelText("Linked user");
    expect(trigger).toHaveTextContent("inactive@example.com");
    await userEvent.click(trigger);
    // Even though this user is `active: false`, it's the Share's own current
    // link, so it must still appear as a selectable row in the open list
    // (this spec's Boundaries: "always included regardless") -- queried by
    // `role="option"` specifically, since the trigger itself (still showing
    // the same text) is a plain button, not an option row.
    expect(await screen.findByRole("option", { name: "inactive@example.com" })).toBeInTheDocument();
  });

  it("owner_admin: quick-add creates a partner-role user, shows the password inline, and only on Done sets the link and fills the Share's Name if empty", async () => {
    listUsers.mockResolvedValue([]);
    createUserAccount.mockResolvedValue(makeUser({ id: "user-new", email: "new-partner@example.com" }));
    render(<SharesPage />);

    await screen.findByText("Partner A");
    await userEvent.click(screen.getByRole("button", { name: "Add Partner" }));
    await userEvent.click(await screen.findByLabelText("Linked user"));
    await userEvent.click(await screen.findByText("+ Add New User"));

    await userEvent.type(screen.getByLabelText("User's name"), "New Partner");
    await userEvent.type(screen.getByLabelText("Email"), "new-partner@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Create User" }));

    await waitFor(() =>
      expect(createUserAccount).toHaveBeenCalledWith({
        email: "new-partner@example.com",
        password: "Gener4ted!Pass",
        role: "partner",
      }),
    );
    // Password phase: the outer dialog's own "Name" field is untouched until Done.
    expect(await screen.findByLabelText("Password")).toHaveValue("Gener4ted!Pass");
    expect(screen.getByLabelText("Name")).toHaveValue("");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByLabelText("Name")).toHaveValue("New Partner");
    await waitFor(() => expect(screen.getByLabelText("Linked user")).toHaveTextContent("new-partner@example.com"));
  });

  it("Sub-partner dialog's quick-add creates a sub_partner-role user, never partner", async () => {
    listUsers.mockResolvedValue([]);
    createUserAccount.mockResolvedValue(makeUser({ id: "user-new-sub", email: "new-sub@example.com", role: "sub_partner" }));
    render(<SharesPage />);

    await screen.findByText("Partner A");
    await userEvent.click(screen.getByRole("button", { name: /Sub-partners/ }));
    await screen.findByText("Sub One");
    await userEvent.click(screen.getByRole("button", { name: "Add Sub-partner" }));
    await userEvent.click(await screen.findByLabelText("Linked user"));
    await userEvent.click(await screen.findByText("+ Add New User"));

    await userEvent.type(screen.getByLabelText("User's name"), "New Sub");
    await userEvent.type(screen.getByLabelText("Email"), "new-sub@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Create User" }));

    await waitFor(() =>
      expect(createUserAccount).toHaveBeenCalledWith(
        expect.objectContaining({ email: "new-sub@example.com", role: "sub_partner" }),
      ),
    );
  });

  it("does not render '+ Add New User' while the user directory hasn't loaded (fails safe)", async () => {
    listUsers.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SharesPage />);

    await screen.findByText("Partner A");
    await userEvent.click(screen.getByRole("button", { name: "Add Partner" }));
    await userEvent.click(await screen.findByLabelText("Linked user"));

    expect(screen.queryByText("+ Add New User")).not.toBeInTheDocument();
  });
});
