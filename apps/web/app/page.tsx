import { cookies } from "next/headers";
import { getSession, listSessions } from "@niveshbook/core";
import { createSessionPort } from "@niveshbook/db";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { LoginForm } from "./LoginForm";
import { LogoutButton } from "./LogoutButton";
import { SessionList } from "./SessionList";

// Session state depends on the request's cookie — never statically cached.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionPort = createSessionPort();
  const session = await getSession(token, { sessions: sessionPort });

  if (!session) {
    return (
      <main style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
        <h1>NiveshBook</h1>
        <LoginForm />
      </main>
    );
  }

  const sessions = await listSessions(session.userId, { sessions: sessionPort });

  return (
    <main style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <h1>NiveshBook</h1>
      <p>You&apos;re logged in.</p>
      <LogoutButton />
      <SessionList
        sessions={sessions.map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
        }))}
        currentSessionId={session.id}
      />
    </main>
  );
}
