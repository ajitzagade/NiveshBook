import Link from "next/link";
import { LayoutDashboard, LayoutGrid } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "@niveshbook/ui";
import { LogoutButton } from "../../LogoutButton";

// Placeholder only — the real role-scoped dashboard (Owner/Admin, Partner,
// Sub-partner variants) is Epic 5 (Stories 5.4/5.5/5.6), not this story. The
// EmptyState below is presentation only — no dashboard numbers are invented.
export const dynamic = "force-dynamic";

export default function DashboardHomePage() {
  return (
    <div>
      <PageHeader title="Home" action={<LogoutButton />} />

      <Card>
        <EmptyState
          icon={<LayoutDashboard size={22} />}
          title="Your dashboard isn't ready yet"
          description="Once you create a Project and add Partner Shares, an overview of money added, withdrawn, and pending will appear here."
          action={
            <Button asChild variant="ghost">
              <Link href="/projects" className="inline-flex items-center gap-1.5">
                <LayoutGrid size={14} />
                Go to Projects
              </Link>
            </Button>
          }
        />
      </Card>
    </div>
  );
}
