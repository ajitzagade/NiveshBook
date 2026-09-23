import { LogoutButton } from "../../LogoutButton";

// Placeholder only — the real role-scoped dashboard (Owner/Admin, Partner,
// Sub-partner variants) is Epic 5 (Stories 5.4/5.5/5.6), not this story.
export const dynamic = "force-dynamic";

export default function DashboardHomePage() {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px]">Home</h1>
          <p className="mt-1 text-[13.4px] text-ink-soft">
            Your dashboard will appear here once Projects and Partner Shares are set up.
          </p>
        </div>
        <LogoutButton />
      </div>
    </div>
  );
}
