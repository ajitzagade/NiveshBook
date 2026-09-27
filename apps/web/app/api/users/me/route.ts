import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@niveshbook/core";
import { createSessionPort, createUserPort } from "@niveshbook/db";
import { readSessionToken } from "@/lib/session";
import { sanitizeUser, UNAUTHENTICATED_MESSAGE } from "@/lib/users";

const NOT_FOUND_MESSAGE = "User not found.";

/**
 * The caller's own sanitized profile (spec-user-reset-deactivate) -- a
 * static sibling of the dynamic `[id]` segment (Next.js resolves the exact
 * literal `/api/users/me` path here in preference to `[id]/route.ts`, never
 * treating `"me"` as an id). No `authorize()` call: viewing your own profile
 * is inherently self-scoped by construction (the id comes from the caller's
 * own live session, never a request param), the same intent `authorize()`'s
 * `SELF_ACCESS_ACTIONS` override already grants for `"users:view"` -- this
 * route needs no permission table lookup at all to reach the identical
 * result.
 *
 * Exists solely so the `"use client"` Users screen can resolve "which row is
 * mine" (spec-user-reset-deactivate, Decision #2's UI-only "disable
 * Deactivate on my own row" safeguard) -- the session cookie itself is
 * `httpOnly` and unreadable from client JS, so there is no other way for
 * that page to know its own caller's id without a round trip like this one.
 */
export async function GET(request: NextRequest) {
  const token = readSessionToken(request);
  const session = await getSession(token, { sessions: createSessionPort() });

  if (!session) {
    return NextResponse.json(
      { code: "unauthenticated", message: UNAUTHENTICATED_MESSAGE },
      { status: 401 },
    );
  }

  const target = await createUserPort().findUserById(session.userId);

  if (!target) {
    // Shouldn't happen in practice (a live session implies its owning user
    // row still exists) -- handled defensively rather than assumed.
    return NextResponse.json({ code: "not_found", message: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  return NextResponse.json(sanitizeUser(target));
}
