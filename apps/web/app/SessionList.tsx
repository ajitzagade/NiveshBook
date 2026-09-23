"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    <section style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 18 }}>Active Sessions</h2>
      {error ? (
        <p role="alert" style={{ color: "#c0392b", margin: "0 0 8px" }}>
          {error}
        </p>
      ) : null}
      {sessions.length === 0 ? (
        <p>No active sessions.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {sessions.map((s) => {
            const isCurrent = s.id === currentSessionId;
            return (
              <li
                key={s.id}
                style={{
                  padding: "12px 0",
                  borderBottom: "1px solid #e0e0e0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div>
                    {isCurrent ? "This session" : `Session ${s.id}`}
                    {isCurrent ? (
                      <span style={{ fontSize: 12, color: "#2d6cdf", marginLeft: 8 }}>
                        (this device, right now)
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 13, color: "#555" }}>
                    Created: {formatDate(s.createdAt)}
                  </div>
                  <div style={{ fontSize: 13, color: "#555" }}>
                    Expires: {formatDate(s.expiresAt)}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(s.id)}
                  disabled={revokingId === s.id}
                  style={{ padding: 8 }}
                >
                  {revokingId === s.id ? "Revoking…" : "Revoke"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
