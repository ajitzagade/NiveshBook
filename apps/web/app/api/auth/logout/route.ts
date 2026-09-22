import { NextResponse, type NextRequest } from "next/server";
import { hashToken, logout } from "@niveshbook/core";
import { createSessionPort } from "@niveshbook/db";
import { clearSessionCookie, readSessionToken } from "@/lib/session";

export async function POST(request: NextRequest) {
  const token = readSessionToken(request);

  if (token) {
    try {
      // Deletes the session row server-side — logout is never just a
      // client-side cookie clear (AD-8).
      await logout(hashToken(token), { sessions: createSessionPort() });
    } catch {
      return NextResponse.json(
        { code: "internal_error", message: "Something went wrong. Please try again." },
        { status: 500 },
      );
    }
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
