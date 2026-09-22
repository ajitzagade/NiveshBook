"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    setError(null);
    setSubmitting(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {error ? (
        <p role="alert" style={{ color: "#c0392b", margin: "0 0 8px" }}>
          {error}
        </p>
      ) : null}
      <button onClick={handleLogout} disabled={submitting} style={{ padding: 10 }}>
        {submitting ? "Logging out…" : "Log out"}
      </button>
    </div>
  );
}
