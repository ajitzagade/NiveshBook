"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Project } from "@niveshbook/types";
import { Button, Card, Table, TableHead, TableBody, TableRow, Th, Td } from "@niveshbook/ui";
import { listProjects } from "@/lib/projects";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; projects: Project[] };

/**
 * Projects list (Story 2.1): fetches `GET /api/projects` client-side and
 * renders all four required states (NFR8) — loading, error, empty, loaded.
 * Owner/Admin-only at the API layer (`authorizeScope("projects:list")`) —
 * a non-Owner/Admin sees the plain error state below, not partial data.
 */
export default function ProjectsPage() {
  const [state, setState] = useState<ListState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    listProjects()
      .then((projects) => {
        if (!cancelled) setState({ status: "loaded", projects });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Something went wrong.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px]">Projects</h1>
          <p className="mt-1 text-[13.4px] text-ink-soft">
            Create and edit Projects. Partner Shares are added separately, after the Project exists.
          </p>
        </div>
        <Button asChild>
          <Link href="/projects/new">+ New Project</Link>
        </Button>
      </div>

      <Card>
        {state.status === "loading" ? (
          <p className="text-[13.4px] text-ink-soft">Loading Projects…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.projects.length === 0 ? (
          <p className="text-[13.4px] text-ink-soft">
            No Projects yet. Create your first Project to get started.
          </p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <Th>Name</Th>
                <Th className="!text-left">Description</Th>
                <Th className="!text-left">Actions</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {state.projects.map((project) => (
                <TableRow key={project.id}>
                  <Td className="font-semibold">{project.name}</Td>
                  <Td className="!text-left text-ink-soft">{project.description ?? "—"}</Td>
                  <Td className="!text-left">
                    <Button asChild variant="ghost">
                      <Link href={`/projects/${project.id}/edit`}>Edit</Link>
                    </Button>
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
