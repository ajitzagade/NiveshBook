import { cookies } from "next/headers";
import Link from "next/link";
import { getSession, listSessions } from "@niveshbook/core";
import { createSessionPort } from "@niveshbook/db";
import { Button, Card, Logo } from "@niveshbook/ui";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { getClientConfig } from "@/lib/client-config";
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
  const { appName } = getClientConfig().branding;

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ground p-4">
        <Card className="w-full max-w-[360px]">
          <div className="mb-5 flex flex-col items-center text-center">
            <Logo className="mb-2.5" />
            <div className="text-[15px] font-bold tracking-tight text-ink">{appName}</div>
            <p className="mt-1 text-[13px] text-ink-soft">Sign in to your workspace</p>
          </div>
          <LoginForm />
        </Card>
      </div>
    );
  }

  const sessions = await listSessions(session.userId, { sessions: sessionPort });

  return (
    <div className="min-h-screen bg-ground p-7">
      <div className="mx-auto max-w-[520px]">
        <div className="mb-5 flex items-center gap-2">
          <Logo />
          <span className="text-[15px] font-bold tracking-tight text-ink">{appName}</span>
        </div>

        <Card className="mb-5">
          <p className="text-[14px] text-ink">You&apos;re logged in.</p>
          <div className="mt-3 flex gap-2.5">
            <Button asChild>
              <Link href="/home">Go to dashboard</Link>
            </Button>
            <LogoutButton />
          </div>
        </Card>

        <SessionList
          sessions={sessions.map((s) => ({
            id: s.id,
            createdAt: s.createdAt,
            expiresAt: s.expiresAt,
          }))}
          currentSessionId={session.id}
        />
      </div>
    </div>
  );
}
