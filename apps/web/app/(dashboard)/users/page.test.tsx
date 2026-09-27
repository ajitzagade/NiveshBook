// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UsersPage from "./page";

const listUsers = vi.fn();
const createUserAccount = vi.fn();

vi.mock("@/lib/users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/users")>("@/lib/users");
  return {
    ...actual,
    listUsers: (...args: unknown[]) => listUsers(...args),
    createUserAccount: (...args: unknown[]) => createUserAccount(...args),
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

beforeEach(() => {
  listUsers.mockReset();
  createUserAccount.mockReset();
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
