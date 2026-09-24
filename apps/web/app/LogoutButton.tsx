"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@niveshbook/ui";

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
        <p role="alert" className="mb-2 text-[13.4px] text-danger">
          {error}
        </p>
      ) : null}
      <Button type="button" variant="ghost" onClick={handleLogout} disabled={submitting}>
        {submitting ? "Logging out…" : "Log out"}
      </Button>
    </div>
  );
}
