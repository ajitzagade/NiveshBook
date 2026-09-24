"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, StatusChip } from "@niveshbook/ui";

export interface SessionListItem {
  id: string;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** ISO 8601 timestamp */
  expiresAt: string;
}

interface SessionListProps {
  sessions: SessionListItem[];
  /** The session id currently authenticating this request, if any. */
  currentSessionId?: string;
}

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

function formatDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString();
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
  } catch {
    // Body wasn't JSON (or had no message) — fall through to the generic one.
  }
  return GENERIC_ERROR_MESSAGE;
}

export function SessionList({ sessions: initialSessions, currentSessionId }: SessionListProps) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke(id: string) {
    setError(null);
    setRevokingId(id);
    try {
      const response = await fetch(`/api/auth/sessions/${id}`, { method: "DELETE" });

      if (!response.ok) {
        setError(await readErrorMessage(response));
        // The row we tried to revoke may already be stale (already gone,
        // or revoked elsewhere) — resync with the server either way.
        router.refresh();
        return;
      }

      setSessions((current) => current.filter((s) => s.id !== id));
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Card>
      <h2 className="mb-3.5 text-[15.5px]">Active Sessions</h2>
      {error ? (
        <p role="alert" className="mb-3 text-[13.4px] text-danger">
          {error}
        </p>
      ) : null}
      {sessions.length === 0 ? (
        <p className="text-[13.4px] text-ink-soft">No active sessions.</p>
      ) : (
        <ul>
          {sessions.map((s) => {
            const isCurrent = s.id === currentSessionId;
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-b-0"
              >
                <div>
                  <div className="flex items-center gap-2 text-[13.6px] font-semibold text-ink">
                    {isCurrent ? "This session" : `Session ${s.id}`}
                    {isCurrent ? (
                      <StatusChip variant="info">this device, right now</StatusChip>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[11.8px] text-ink-faint">
                    Created: {formatDate(s.createdAt)}
                  </div>
                  <div className="text-[11.8px] text-ink-faint">
                    Expires: {formatDate(s.expiresAt)}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleRevoke(s.id)}
                  disabled={revokingId === s.id}
                >
                  {revokingId === s.id ? "Revoking…" : "Revoke"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
