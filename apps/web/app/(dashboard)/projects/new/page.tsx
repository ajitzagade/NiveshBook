"use client";

import { useRouter } from "next/navigation";
import { Card, PageHeader } from "@niveshbook/ui";
import { ProjectQuickAddForm } from "../ProjectQuickAddForm";

/**
 * Create-Project page (Story 2.1, AC1/AC2). The actual name/description
 * form now lives in `ProjectQuickAddForm` (spec-quick-add-project-user-
 * modals) -- shared with every Combobox's inline "+ Add New Project" row --
 * this page is just that form inside its own `PageHeader`/`Card` shell,
 * navigating to `/projects` on success/cancel exactly as before.
 */
export default function NewProjectPage() {
  const router = useRouter();

  return (
    <div>
      <PageHeader
        title="New Project"
        description="Create a Project with a name and description — Partner Shares are added later, in a separate step."
      />

      <Card className="max-w-[520px]">
        <ProjectQuickAddForm
          onCancel={() => router.push("/projects")}
          onCreated={() => {
            router.push("/projects");
            router.refresh();
          }}
        />
      </Card>
    </div>
  );
}
