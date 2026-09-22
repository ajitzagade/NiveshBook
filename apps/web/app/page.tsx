import { cookies } from "next/headers";
import { getSession } from "@niveshbook/core";
import { createSessionPort } from "@niveshbook/db";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { LoginForm } from "./LoginForm";
import { LogoutButton } from "./LogoutButton";

// Session state depends on the request's cookie — never statically cached.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSession(token, { sessions: createSessionPort() });

  return (
    <main style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <h1>NiveshBook</h1>
      {session ? (
        <>
          <p>You&apos;re logged in.</p>
          <LogoutButton />
        </>
      ) : (
        <LoginForm />
      )}
    </main>
  );
}
