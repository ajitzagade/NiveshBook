"use client";

import { useEffect, useState } from "react";
import { FileText, FolderKanban } from "lucide-react";
import type { ProjectListItem } from "@niveshbook/types";
import { Button, Card, Checkbox, EmptyState, PageHeader } from "@niveshbook/ui";
import { listProjects } from "@/lib/projects";
import { getProjectMoneyFlowReport, type ProjectMoneyFlowReportProject } from "@/lib/project-money-flow-report";
import { captureStructureDiagrams, type CapturedFlowDiagrams } from "./capture-flow-diagram";
import { generateProjectMoneyFlowPdf } from "./project-money-flow-pdf";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; projects: ProjectListItem[] };

/**
 * Project Money Flow Report (Owner/Admin only) -- pick one or more Projects,
 * click Generate, get one downloadable PDF covering each selected Project's
 * complete picture: itemized transactions, Should Pay/Can Take, cross-project
 * links, ownership share breakdown, and the ownership/money-flow diagram in
 * all 3 view modes. Deliberately a standalone page, not the generic
 * `/reports/[type]` flat-table viewer -- see `../page.tsx`'s own tile
 * comment for why.
 *
 * Generation is entirely client-side, matching this codebase's established
 * `report-export.ts` pattern: fetch the combined report data
 * (`getProjectMoneyFlowReport`), then for each returned Project, mount its
 * ownership diagram off-screen and capture all 3 view modes
 * (`captureStructureDiagrams`), then build and download the PDF
 * (`generateProjectMoneyFlowPdf`). Sequential across Projects -- this can
 * take a visible number of seconds for several Projects, hence the progress
 * text below the button.
 */
export default function ProjectMoneyFlowReportPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((projects) => {
        if (!cancelled) {
          setState({ status: "loaded", projects });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Something went wrong. Please try again.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleProject(projectId: string) {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  async function handleGenerate() {
    setGenerateError(null);
    setGenerating(true);
    try {
      const projectIds = Array.from(selectedProjectIds);
      setProgressText("Fetching report data…");
      const { projects } = await getProjectMoneyFlowReport(projectIds);

      const diagramsByProjectId = new Map<string, CapturedFlowDiagrams>();
      for (const [index, project] of (projects as ProjectMoneyFlowReportProject[]).entries()) {
        setProgressText(`Capturing diagrams for ${project.projectName} (${index + 1}/${projects.length})…`);
        const diagrams = await captureStructureDiagrams(project.tree, project.projectName, project.moneyFlowEdges);
        diagramsByProjectId.set(project.projectId, diagrams);
      }

      setProgressText("Building PDF…");
      await generateProjectMoneyFlowPdf(projects, diagramsByProjectId);
      setProgressText(null);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setProgressText(null);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Project Money Flow Report"
        description="Select one or more Projects to generate a complete, downloadable PDF -- transactions, Should Pay/Can Take, ownership shares, and the Money Flow diagram."
      />

      {state.status === "loading" ? (
        <Card>
          <p className="text-[13.4px] text-ink-faint">Loading Projects…</p>
        </Card>
      ) : state.status === "error" ? (
        <Card>
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        </Card>
      ) : state.projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban size={22} />}
            title="No Projects yet"
            description="Create a Project first -- this report needs at least one to generate."
          />
        </Card>
      ) : (
        <Card>
          <ul className="mb-4 flex flex-col gap-2">
            {state.projects.map((project) => (
              <li key={project.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-el p-2 hover:bg-surface-alt">
                  <Checkbox
                    checked={selectedProjectIds.has(project.id)}
                    onChange={() => toggleProject(project.id)}
                  />
                  <span className="text-[13.4px] text-ink">{project.name}</span>
                </label>
              </li>
            ))}
          </ul>

          {generateError ? (
            <p role="alert" className="mb-3 text-[13.4px] text-danger">
              {generateError}
            </p>
          ) : null}

          <Button
            type="button"
            onClick={handleGenerate}
            disabled={selectedProjectIds.size === 0 || generating}
            icon={<FileText size={14} />}
          >
            {generating ? "Generating…" : "Generate PDF Report"}
          </Button>

          {progressText ? <p className="mt-2.5 text-[12.6px] text-ink-soft">{progressText}</p> : null}
        </Card>
      )}
    </div>
  );
}
