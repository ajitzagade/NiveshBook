// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionList, type SessionListItem } from "./SessionList";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const SESSIONS: SessionListItem[] = [
  {
    id: "session-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:30:00.000Z",
  },
  {
    id: "session-2",
    createdAt: "2026-01-02T00:00:00.000Z",
    expiresAt: "2026-01-02T00:30:00.000Z",
  },
];

describe("SessionList", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a populated session list with locale-formatted dates, not raw ISO strings", () => {
    render(<SessionList sessions={SESSIONS} />);

    expect(screen.getByText(/Session session-1/)).toBeInTheDocument();
    expect(screen.getByText(/Session session-2/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /revoke/i })).toHaveLength(2);

    // The raw ISO timestamp must not appear verbatim in the rendered output.
    expect(screen.queryByText("2026-01-01T00:00:00.000Z")).not.toBeInTheDocument();
  });

  it("labels the caller's current session distinctly", () => {
    render(<SessionList sessions={SESSIONS} currentSessionId="session-1" />);

    expect(screen.getByText(/This session/)).toBeInTheDocument();
    expect(screen.queryByText(/Session session-1/)).not.toBeInTheDocument();
  });

  it("removes the row on a successful revoke and refreshes", async () => {
    const user = userEvent.setup();
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    render(<SessionList sessions={SESSIONS} />);

    const buttons = screen.getAllByRole("button", { name: /revoke/i });
    await user.click(buttons[0]!);

    await waitFor(() => {
      expect(screen.queryByText(/Session session-1/)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Session session-2/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/auth/sessions/session-1", { method: "DELETE" });
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the server's error message on a failed revoke and keeps the row, but still refreshes", async () => {
    const user = userEvent.setup();
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ code: "not_found", message: "Session not found." }), {
        status: 404,
      }),
    );

    render(<SessionList sessions={SESSIONS} />);

    const buttons = screen.getAllByRole("button", { name: /revoke/i });
    await user.click(buttons[0]!);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Session not found.");
    });
    // The row stays — this failure wasn't a confirmed deletion.
    expect(screen.getByText(/Session session-1/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a generic network-error message when the fetch itself throws", async () => {
    const user = userEvent.setup();
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));

    render(<SessionList sessions={SESSIONS} />);

    const buttons = screen.getAllByRole("button", { name: /revoke/i });
    await user.click(buttons[0]!);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Network error/i);
    });
  });

  it("renders an empty state with no sessions", () => {
    render(<SessionList sessions={[]} />);

    expect(screen.getByText(/No active sessions/i)).toBeInTheDocument();
  });
});
