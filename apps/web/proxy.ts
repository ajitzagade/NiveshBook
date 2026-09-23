import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@niveshbook/core";
import { createSessionPort } from "@niveshbook/db";
import { readSessionToken, setSessionCookie } from "@/lib/session";

// proxy.ts runs on the Node.js runtime by default — no explicit opt-in
// needed (unlike the deprecated middleware.ts convention). The session port
// talks to Postgres over a real TCP socket (drizzle's postgres-js driver),
// which requires Node.js rather than Edge.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/auth/login|api/auth/logout).*)"],
};

/**
 * `getSession()` slides the session row's `expiresAt` forward on every
 * successful resolution (sliding-window renewal, FR5), but that alone only
 * updates the server-side row — the session cookie's own `Max-Age` was set
 * once at login and, unrefreshed, would still make the browser stop sending
 * it 30 minutes after login regardless of activity. This proxy re-issues the
 * cookie with a fresh `Max-Age` on every request that carries a still-valid
 * session, so the client-side lifetime tracks the server-side renewal.
 */
export async function proxy(request: NextRequest) {
  const token = readSessionToken(request);

  if (!token) {
    return NextResponse.next();
  }

  const session = await getSession(token, { sessions: createSessionPort() });
  const response = NextResponse.next();

  if (session) {
    setSessionCookie(response, token);
  }

  return response;
}
