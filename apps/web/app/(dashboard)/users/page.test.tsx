// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UsersPage from "./page";
import type { SanitizedUser } from "@/lib/users";

const listUsers = vi.fn();
const createUserAccount = vi.fn();
const getCurrentUser = vi.fn();
const setUserActive = vi.fn();
const resetUserPassword = vi.fn();
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/lib/users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/users")>("@/lib/users");
  return {
    ...actual,
    listUsers: (...args: unknown[]) => listUsers(...args),
    createUserAccount: (...args: unknown[]) => createUserAccount(...args),
    getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
    setUserActive: (...args: unknown[]) => setUserActive(...args),
    resetUserPassword: (...args: unknown[]) => resetUserPassword(...args),
  };
});

const OWNER = {
  id: "user-1",
  email: "owner@niveshbook.test",
  role: "owner_admin" as const,
  active: true,
  createdAt: new Date().toISOString(),
};

const PARTNER = {
  id: "user-2",
  email: "partner@niveshbook.test",
  role: "partner" as const,
  active: false,
  createdAt: new Date().toISOString(),
};

// A second ACTIVE user, distinct from OWNER -- needed for tests that
// exercise two independently-toggling Deactivate rows at once (PARTNER above
// is inactive, so it only ever offers Activate).
const PARTNER_ACTIVE = {
  id: "user-3",
  email: "partner-active@niveshbook.test",
  role: "partner" as const,
  active: true,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  listUsers.mockReset();
  createUserAccount.mockReset();
  getCurrentUser.mockReset();
  setUserActive.mockReset();
  resetUserPassword.mockReset();
  routerPush.mockReset();
  // Default: resolves to some id that never matches any seeded test user, so
  // pre-existing tests (which don't care about the "disable my own row"
  // safeguard) never accidentally have a row disabled out from under them.
  // Never rejected by default either -- an unhandled rejection here would
  // otherwise pollute every test that doesn't explicitly care.
  getCurrentUser.mockResolvedValue({
    id: "nobody-in-particular",
    email: "nobody@niveshbook.test",
    role: "owner_admin",
    active: true,
    createdAt: new Date().toISOString(),
  });
});

afterEach(() => {
  cleanup();
});

/**
 * `userEvent.setup()` itself installs its own in-memory `navigator.clipboard`
 * stub (`attachClipboardStubToView`, unconditional) -- defining our own
 * clipboard mock BEFORE calling `userEvent.setup()` (e.g. in a shared
 * `beforeEach`) gets silently clobbered the moment `setup()` runs. Spying on
 * the stub's own `writeText` AFTER `setup()` (its real, working
 * implementation) is the reliable way to observe a call, mirroring the
 * documented workaround for this well-known user-event/jsdom interaction.
 */
function setupUserWithClipboardSpy() {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText");
  return { user, writeText };
}

describe("UsersPage (spec-user-creation)", () => {
  it("shows a loading state, then the loaded Table with Email/Role/Status", async () => {
    listUsers.mockResolvedValue([OWNER, PARTNER]);

    render(<UsersPage />);

    expect(screen.getByText(/Loading Users/)).toBeInTheDocument();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("owner@niveshbook.test")).toBeInTheDocument();
    expect(within(table).getByText("Owner/Admin")).toBeInTheDocument();
    expect(within(table).getByText("Active")).toBeInTheDocument();
    expect(within(table).getByText("partner@niveshbook.test")).toBeInTheDocument();
    expect(within(table).getByText("Partner")).toBeInTheDocument();
    expect(within(table).getByText("Inactive")).toBeInTheDocument();
  });

  it("renders the below-860px RowCard stack with the same data", async () => {
    listUsers.mockResolvedValue([OWNER]);

    render(<UsersPage />);

    const cards = await screen.findByTestId("users-row-cards");
    expect(within(cards).getByText("owner@niveshbook.test")).toBeInTheDocument();
    expect(within(cards).getByText("Owner/Admin")).toBeInTheDocument();
    expect(within(cards).getByText("Active")).toBeInTheDocument();
  });

  // jsdom never evaluates CSS, so a swapped/dropped breakpoint class would
  // still leave every other assertion green -- assert the actual wiring
  // directly, mirroring `projects/page.test.tsx`'s identical pattern.
  it("wires the desktop Table and mobile RowCard stack to opposite ends of the 860px breakpoint", async () => {
    listUsers.mockResolvedValue([OWNER]);

    render(<UsersPage />);

    const table = await screen.findByRole("table");
    const tableWrapper = table.closest('[class*="860px"]');
    expect(tableWrapper?.className).toContain("max-[860px]:hidden");

    const cards = screen.getByTestId("users-row-cards");
    expect(cards.className).toContain("hidden");
    expect(cards.className).toContain("max-[860px]:block");
  });

  it("shows an error state with role=alert on a failed fetch", async () => {
    listUsers.mockRejectedValue(new Error("Something broke"));

    render(<UsersPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Something broke");
  });

  it("shows the empty state when there are no users yet", async () => {
    listUsers.mockResolvedValue([]);

    render(<UsersPage />);

    expect(await screen.findByText("No Users yet")).toBeInTheDocument();
  });

  it("New User dialog offers only the 3 creatable roles -- never project_admin", async () => {
    listUsers.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByText("No Users yet");
    await user.click(screen.getAllByRole("button", { name: /New User/ })[0]!);

    const dialog = screen.getByRole("dialog");
    const roleSelect = within(dialog).getByLabelText("Role") as HTMLSelectElement;
    const optionLabels = Array.from(roleSelect.options).map((option) => option.textContent);

    expect(optionLabels).toEqual(["Owner/Admin", "Partner", "Sub-partner"]);
  });

  it("Generate fills the password field with a 12-character value, and Copy copies it", async () => {
    listUsers.mockResolvedValue([]);
    const { user, writeText } = setupUserWithClipboardSpy();

    render(<UsersPage />);
    await screen.findByText("No Users yet");
    await user.click(screen.getAllByRole("button", { name: /New User/ })[0]!);

    await user.click(screen.getByRole("button", { name: /Generate/ }));

    const passwordInput = screen.getByLabelText("Password") as HTMLInputElement;
    expect(passwordInput.value).toHaveLength(12);

    await user.click(screen.getByRole("button", { name: /^Copy$/ }));
    expect(writeText).toHaveBeenCalledWith(passwordInput.value);
  });

  it("blocks submission client-side for a password under 8 characters -- createUserAccount is never called", async () => {
    listUsers.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByText("No Users yet");
    await user.click(screen.getAllByRole("button", { name: /New User/ })[0]!);

    await user.type(screen.getByLabelText("Email"), "new@niveshbook.test");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: /^Create$/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 8 characters/i);
    expect(createUserAccount).not.toHaveBeenCalled();
  });

  it("blocks submission client-side for a password over 128 characters -- createUserAccount is never called (review fix)", async () => {
    listUsers.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByText("No Users yet");
    await user.click(screen.getAllByRole("button", { name: /New User/ })[0]!);

    await user.type(screen.getByLabelText("Email"), "new@niveshbook.test");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a".repeat(129) } });
    await user.click(screen.getByRole("button", { name: /^Create$/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at most 128 characters/i);
    expect(createUserAccount).not.toHaveBeenCalled();
  });

  it("email and password fields in the create form have autoComplete off (review fix)", async () => {
    listUsers.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByText("No Users yet");
    await user.click(screen.getAllByRole("button", { name: /New User/ })[0]!);

    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "off");
  });

  it("owner_admin requires an explicit second click before it actually creates the account (review fix)", async () => {
    listUsers.mockResolvedValue([]);
    createUserAccount.mockResolvedValue({
      id: "new-owner-1",
      email: "new-owner@niveshbook.test",
      role: "owner_admin",
      active: true,
      createdAt: new Date().toISOString(),
    });
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByText("No Users yet");
    await user.click(screen.getAllByRole("button", { name: /New User/ })[0]!);

    await user.type(screen.getByLabelText("Email"), "new-owner@niveshbook.test");
    await user.type(screen.getByLabelText("Password"), "a-fine-password");
    await user.selectOptions(screen.getByLabelText("Role"), "Owner/Admin");

    // First click only asks for confirmation -- no create call yet.
    await user.click(screen.getByRole("button", { name: /Create/ }));
    expect(createUserAccount).not.toHaveBeenCalled();
    expect(screen.getByText(/creates another Owner\/Admin account/i)).toBeInTheDocument();

    // Second click (the button's own label changed) actually creates it.
    await user.click(screen.getByRole("button", { name: /Yes, Create Owner\/Admin/ }));
    expect(createUserAccount).toHaveBeenCalledWith({
      email: "new-owner@niveshbook.test",
      password: "a-fine-password",
      role: "owner_admin",
    });
    expect(await screen.findByText("User created")).toBeInTheDocument();
  });

  it("switching role away from owner_admin and back resets the pending confirmation", async () => {
    listUsers.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByText("No Users yet");
    await user.click(screen.getAllByRole("button", { name: /New User/ })[0]!);

    await user.type(screen.getByLabelText("Email"), "new-owner@niveshbook.test");
    await user.type(screen.getByLabelText("Password"), "a-fine-password");
    await user.selectOptions(screen.getByLabelText("Role"), "Owner/Admin");
    await user.click(screen.getByRole("button", { name: /Create/ }));
    expect(screen.getByText(/creates another Owner\/Admin account/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Role"), "Partner");
    await user.selectOptions(screen.getByLabelText("Role"), "Owner/Admin");

    expect(screen.queryByText(/creates another Owner\/Admin account/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Create$/ })).toBeInTheDocument();
  });

  it("shows the success state even when the background refresh() after a successful create fails (review fix)", async () => {
    listUsers.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("refresh failed"));
    createUserAccount.mockResolvedValue({
      id: "new-1",
      email: "new-partner@niveshbook.test",
      role: "partner",
      active: true,
      createdAt: new Date().toISOString(),
    });
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByText("No Users yet");
    await user.click(screen.getAllByRole("button", { name: /New User/ })[0]!);

    await user.type(screen.getByLabelText("Email"), "new-partner@niveshbook.test");
    await user.type(screen.getByLabelText("Password"), "a-fine-password");
    await user.click(screen.getByRole("button", { name: /^Create$/ }));

    // The create itself succeeded -- the success state (with the one-time
    // password) must show, never the generic "something went wrong" error,
    // even though the follow-up list refresh failed.
    expect(await screen.findByText("User created")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("creates a user, then shows the password once more in a copyable success state with a 'won't be shown again' notice", async () => {
    listUsers.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: "new-1", email: "new-partner@niveshbook.test", role: "partner", active: true, createdAt: new Date().toISOString() },
    ]);
    createUserAccount.mockResolvedValue({
      id: "new-1",
      email: "new-partner@niveshbook.test",
      role: "partner",
      active: true,
      createdAt: new Date().toISOString(),
    });
    const { user, writeText } = setupUserWithClipboardSpy();

    render(<UsersPage />);
    await screen.findByText("No Users yet");
    await user.click(screen.getAllByRole("button", { name: /New User/ })[0]!);

    await user.type(screen.getByLabelText("Email"), "new-partner@niveshbook.test");
    await user.type(screen.getByLabelText("Password"), "a-fine-password");
    await user.click(screen.getByRole("button", { name: /^Create$/ }));

    expect(createUserAccount).toHaveBeenCalledWith({
      email: "new-partner@niveshbook.test",
      password: "a-fine-password",
      role: "partner",
    });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("User created")).toBeInTheDocument();
    expect(within(dialog).getByText(/won't be shown again/)).toBeInTheDocument();
    const shownPassword = within(dialog).getByLabelText("Password") as HTMLInputElement;
    expect(shownPassword.value).toBe("a-fine-password");
    expect(shownPassword).toHaveAttribute("readonly");

    await user.click(within(dialog).getByRole("button", { name: /Copy/ }));
    expect(writeText).toHaveBeenCalledWith("a-fine-password");

    await user.click(within(dialog).getByRole("button", { name: /Done/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a server-reported error inline without closing the dialog", async () => {
    listUsers.mockResolvedValue([]);
    createUserAccount.mockRejectedValue(new Error("Email already in use."));
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByText("No Users yet");
    await user.click(screen.getAllByRole("button", { name: /New User/ })[0]!);

    await user.type(screen.getByLabelText("Email"), "dup@niveshbook.test");
    await user.type(screen.getByLabelText("Password"), "a-fine-password");
    await user.click(screen.getByRole("button", { name: /^Create$/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email already in use.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});

describe("UsersPage — Reset Password / Activate-Deactivate row actions (spec-user-reset-deactivate)", () => {
  it("renders an Actions column with Reset Password and Deactivate/Activate buttons per row", async () => {
    listUsers.mockResolvedValue([OWNER, PARTNER]);

    render(<UsersPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Actions")).toBeInTheDocument();
    const rows = within(table).getAllByRole("row").slice(1); // drop the header row
    expect(within(rows[0]!).getByRole("button", { name: /Reset Password/ })).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("button", { name: /^Deactivate$/ })).toBeInTheDocument(); // OWNER is active
    expect(within(rows[1]!).getByRole("button", { name: /^Activate$/ })).toBeInTheDocument(); // PARTNER is inactive
  });

  it("renders the same actions in the below-860px RowCard stack", async () => {
    listUsers.mockResolvedValue([OWNER]);

    render(<UsersPage />);

    const cards = await screen.findByTestId("users-row-cards");
    expect(within(cards).getByRole("button", { name: /Reset Password/ })).toBeInTheDocument();
    expect(within(cards).getByRole("button", { name: /^Deactivate$/ })).toBeInTheDocument();
  });

  it("disables Deactivate on the caller's own row, but not on another owner_admin's row", async () => {
    listUsers.mockResolvedValue([OWNER, PARTNER]);
    getCurrentUser.mockResolvedValue(OWNER);

    render(<UsersPage />);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    await waitFor(() => {
      expect(within(rows[0]!).getByRole("button", { name: /^Deactivate$/ })).toBeDisabled();
    });
    expect(within(rows[1]!).getByRole("button", { name: /^Activate$/ })).not.toBeDisabled();
  });

  it("does not disable any row when getCurrentUser() fails -- best-effort only, never blocks the page", async () => {
    listUsers.mockResolvedValue([OWNER]);
    getCurrentUser.mockRejectedValue(new Error("network error"));

    render(<UsersPage />);
    await screen.findByRole("table");

    const button = screen.getAllByRole("button", { name: /^Deactivate$/ })[0]!;
    expect(button).not.toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a single click on Deactivate only arms confirmation -- setUserActive is never called yet", async () => {
    listUsers.mockResolvedValue([OWNER]);
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByRole("table");

    await user.click(screen.getAllByRole("button", { name: /^Deactivate$/ })[0]!);

    expect(setUserActive).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: /Confirm Deactivate\?/ })[0]!).toBeInTheDocument();
  });

  it("a second click on the same row's Deactivate confirmation calls setUserActive(id, false), then refreshes the list", async () => {
    listUsers.mockResolvedValueOnce([OWNER]).mockResolvedValueOnce([{ ...OWNER, active: false }]);
    setUserActive.mockResolvedValue({ ...OWNER, active: false });
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByRole("table");

    await user.click(screen.getAllByRole("button", { name: /^Deactivate$/ })[0]!);
    await user.click(screen.getAllByRole("button", { name: /Confirm Deactivate\?/ })[0]!);

    expect(setUserActive).toHaveBeenCalledWith(OWNER.id, false);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /^Activate$/ })[0]!).toBeInTheDocument();
    });
  });

  it("clicking Deactivate on a different row resets the first row's pending confirmation instead of confirming it", async () => {
    listUsers.mockResolvedValue([OWNER, PARTNER_ACTIVE]);
    const user = userEvent.setup();

    render(<UsersPage />);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);

    await user.click(within(rows[0]!).getByRole("button", { name: /^Deactivate$/ }));
    expect(within(rows[0]!).getByRole("button", { name: /Confirm Deactivate\?/ })).toBeInTheDocument();

    // Clicking row 2's Deactivate is treated as ITS OWN first click, not a
    // stray confirmation of row 1.
    await user.click(within(rows[1]!).getByRole("button", { name: /^Deactivate$/ }));

    expect(setUserActive).not.toHaveBeenCalled();
    expect(within(rows[0]!).getByRole("button", { name: /^Deactivate$/ })).toBeInTheDocument();
    expect(within(rows[1]!).getByRole("button", { name: /Confirm Deactivate\?/ })).toBeInTheDocument();
  });

  it("clicking Activate calls setUserActive(id, true) on a single click -- no confirmation step", async () => {
    listUsers.mockResolvedValue([PARTNER]);
    setUserActive.mockResolvedValue({ ...PARTNER, active: true });
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByRole("table");

    await user.click(screen.getAllByRole("button", { name: /^Activate$/ })[0]!);

    expect(setUserActive).toHaveBeenCalledWith(PARTNER.id, true);
  });

  it("shows an alert-free toast-style error and leaves the row usable when setUserActive fails", async () => {
    listUsers.mockResolvedValue([OWNER]);
    setUserActive.mockRejectedValue(new Error("Something broke"));
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByRole("table");

    await user.click(screen.getAllByRole("button", { name: /^Deactivate$/ })[0]!);
    await user.click(screen.getAllByRole("button", { name: /Confirm Deactivate\?/ })[0]!);

    // The toggle button recovers (re-enabled, label reverted) rather than
    // getting stuck in "Updating…" forever.
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /^Deactivate$/ })[0]!).not.toBeDisabled();
    });
  });

  it("a second row's toggle stays busy independently while a first row's request is still in flight (Set, not a single id)", async () => {
    listUsers.mockResolvedValue([OWNER, PARTNER_ACTIVE]);
    let resolveFirst!: (value: SanitizedUser) => void;
    setUserActive.mockImplementation(
      (id: string) =>
        new Promise<SanitizedUser>((resolve) => {
          if (id === OWNER.id) {
            resolveFirst = resolve;
          } else {
            resolve({ ...PARTNER_ACTIVE, active: false });
          }
        }),
    );
    const user = userEvent.setup();

    render(<UsersPage />);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);

    // Arm and confirm row 1's Deactivate -- its request never resolves yet.
    await user.click(within(rows[0]!).getByRole("button", { name: /^Deactivate$/ }));
    await user.click(within(rows[0]!).getByRole("button", { name: /Confirm Deactivate\?/ }));
    await waitFor(() => {
      expect(within(rows[0]!).getByRole("button", { name: /Updating…/ })).toBeInTheDocument();
    });

    // Arm and confirm row 2's Deactivate while row 1 is still mid-flight.
    await user.click(within(rows[1]!).getByRole("button", { name: /^Deactivate$/ }));
    await user.click(within(rows[1]!).getByRole("button", { name: /Confirm Deactivate\?/ }));

    // Row 1 must still be busy -- row 2's own click must not have cleared it.
    expect(within(rows[0]!).getByRole("button", { name: /Updating…/ })).toBeInTheDocument();

    resolveFirst({ ...OWNER, active: false });
    await waitFor(() => {
      expect(within(rows[0]!).queryByRole("button", { name: /Updating…/ })).not.toBeInTheDocument();
    });
  });

  it("opens the Reset Password dialog, resets, and shows the password once in a copyable success state", async () => {
    listUsers.mockResolvedValueOnce([PARTNER]).mockResolvedValueOnce([PARTNER]);
    resetUserPassword.mockResolvedValue(PARTNER);
    const { user, writeText } = setupUserWithClipboardSpy();

    render(<UsersPage />);
    await screen.findByRole("table");

    await user.click(screen.getAllByRole("button", { name: /Reset Password/ })[0]!);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Reset Password" })).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("New password"), "a-brand-new-password");
    await user.click(within(dialog).getByRole("button", { name: /^Reset Password$/ }));

    expect(resetUserPassword).toHaveBeenCalledWith({
      userId: PARTNER.id,
      password: "a-brand-new-password",
    });

    expect(await within(dialog).findByText("Password reset")).toBeInTheDocument();
    expect(within(dialog).getByText(/won't be shown again/)).toBeInTheDocument();
    const shownPassword = within(dialog).getByLabelText("Password") as HTMLInputElement;
    expect(shownPassword.value).toBe("a-brand-new-password");
    expect(shownPassword).toHaveAttribute("readonly");

    await user.click(within(dialog).getByRole("button", { name: /Copy/ }));
    expect(writeText).toHaveBeenCalledWith("a-brand-new-password");

    await user.click(within(dialog).getByRole("button", { name: /Done/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("blocks Reset Password submission client-side for a password under 8 characters -- resetUserPassword is never called", async () => {
    listUsers.mockResolvedValue([PARTNER]);
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByRole("table");

    await user.click(screen.getAllByRole("button", { name: /Reset Password/ })[0]!);
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("New password"), "short");
    await user.click(within(dialog).getByRole("button", { name: /^Reset Password$/ }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/at least 8 characters/i);
    expect(resetUserPassword).not.toHaveBeenCalled();
  });

  it("blocks Reset Password submission client-side for a password over 128 characters -- resetUserPassword is never called", async () => {
    listUsers.mockResolvedValue([PARTNER]);
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByRole("table");

    await user.click(screen.getAllByRole("button", { name: /Reset Password/ })[0]!);
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("New password"), {
      target: { value: "a".repeat(129) },
    });
    await user.click(within(dialog).getByRole("button", { name: /^Reset Password$/ }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/at most 128 characters/i);
    expect(resetUserPassword).not.toHaveBeenCalled();
  });

  it("Generate fills the Reset Password field with a 12-character value", async () => {
    listUsers.mockResolvedValue([PARTNER]);
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByRole("table");

    await user.click(screen.getAllByRole("button", { name: /Reset Password/ })[0]!);
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: /Generate/ }));

    const passwordInput = within(dialog).getByLabelText("New password") as HTMLInputElement;
    expect(passwordInput.value).toHaveLength(12);
  });

  it("shows a server-reported reset error inline without closing the dialog", async () => {
    listUsers.mockResolvedValue([PARTNER]);
    resetUserPassword.mockRejectedValue(new Error("Something went wrong on the server."));
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByRole("table");

    await user.click(screen.getAllByRole("button", { name: /Reset Password/ })[0]!);
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("New password"), "a-fine-new-password");
    await user.click(within(dialog).getByRole("button", { name: /^Reset Password$/ }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Something went wrong on the server.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  describe("resetting your OWN password (real bug fix: the reset kills the acting admin's own session)", () => {
    it("shows a distinct 'sign back in' message instead of the generic share-this-password copy", async () => {
      listUsers.mockResolvedValue([OWNER]);
      getCurrentUser.mockResolvedValue(OWNER);
      resetUserPassword.mockResolvedValue(OWNER);
      const user = userEvent.setup();

      render(<UsersPage />);
      await screen.findByRole("table");

      await user.click(screen.getAllByRole("button", { name: /Reset Password/ })[0]!);
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("New password"), "a-brand-new-password");
      await user.click(within(dialog).getByRole("button", { name: /^Reset Password$/ }));

      expect(await within(dialog).findByText(/you'll need to sign back in with it/i)).toBeInTheDocument();
      expect(within(dialog).queryByText(/share this password with/i)).not.toBeInTheDocument();
    });

    it("clicking Done after resetting your own password redirects to the login page via router.push", async () => {
      listUsers.mockResolvedValue([OWNER]);
      getCurrentUser.mockResolvedValue(OWNER);
      resetUserPassword.mockResolvedValue(OWNER);
      const user = userEvent.setup();

      render(<UsersPage />);
      await screen.findByRole("table");

      await user.click(screen.getAllByRole("button", { name: /Reset Password/ })[0]!);
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("New password"), "a-brand-new-password");
      await user.click(within(dialog).getByRole("button", { name: /^Reset Password$/ }));
      await within(dialog).findByText(/sign back in/i);

      await user.click(within(dialog).getByRole("button", { name: /Done/ }));

      expect(routerPush).toHaveBeenCalledWith("/");
    });

    it("resetting someone ELSE's password never redirects on Done", async () => {
      listUsers.mockResolvedValue([PARTNER]);
      getCurrentUser.mockResolvedValue(OWNER);
      resetUserPassword.mockResolvedValue(PARTNER);
      const user = userEvent.setup();

      render(<UsersPage />);
      await screen.findByRole("table");

      await user.click(screen.getAllByRole("button", { name: /Reset Password/ })[0]!);
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("New password"), "a-brand-new-password");
      await user.click(within(dialog).getByRole("button", { name: /^Reset Password$/ }));
      await within(dialog).findByText(/won't be shown again/);

      await user.click(within(dialog).getByRole("button", { name: /Done/ }));

      expect(routerPush).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("ignores Escape/backdrop dismissal while a reset is still in flight, so a since-closed dialog can't silently reopen in its success phase", async () => {
    listUsers.mockResolvedValue([PARTNER]);
    let resolveReset!: (value: SanitizedUser) => void;
    resetUserPassword.mockImplementation(
      () => new Promise<SanitizedUser>((resolve) => { resolveReset = resolve; }),
    );
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByRole("table");

    await user.click(screen.getAllByRole("button", { name: /Reset Password/ })[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("New password"), "a-brand-new-password");
    await user.click(within(dialog).getByRole("button", { name: /^Reset Password$/ }));

    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: /Resetting…/ })).toBeInTheDocument();
    });

    // Attempt to dismiss via Escape while the request is still in flight.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    resolveReset(PARTNER);

    expect(await within(screen.getByRole("dialog")).findByText("Password reset")).toBeInTheDocument();
  });
});
