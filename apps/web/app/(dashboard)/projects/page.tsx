"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderKanban, Plus, Pencil, Percent, Minus, Network } from "lucide-react";
import type { Project } from "@niveshbook/types";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Table,
  TableHead,
  TableBody,
  TableRow,
  Th,
  Td,
} from "@niveshbook/ui";
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
      <PageHeader
        title="Projects"
        description="Create and edit Projects. Partner Shares are added separately, after the Project exists."
        action={
          <Button asChild>
            <Link href="/projects/new" className="inline-flex items-center gap-1.5">
              <Plus size={14} />
              New Project
            </Link>
          </Button>
        }
      />

      <Card>
        {state.status === "loading" ? (
          <p className="text-[13.4px] text-ink-soft">Loading Projects…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.projects.length === 0 ? (
          <EmptyState
            icon={<FolderKanban size={22} />}
            title="No Projects yet"
            description="Create your first Project to start tracking partner investments and withdrawals."
            action={
              <Button asChild>
                <Link href="/projects/new" className="inline-flex items-center gap-1.5">
                  <Plus size={14} />
                  New Project
                </Link>
              </Button>
            }
          />
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
                    <div className="flex gap-1.5">
                      <Button asChild variant="ghost">
                        <Link href={`/projects/${project.id}/edit`} className="inline-flex items-center gap-1.5">
                          <Pencil size={14} />
                          Edit
                        </Link>
                      </Button>
                      <Button asChild variant="ghost">
                        <Link href={`/projects/${project.id}/shares`} className="inline-flex items-center gap-1.5">
                          <Percent size={14} />
                          Shares
                        </Link>
                      </Button>
                      <Button asChild variant="ghost">
                        <Link href={`/projects/${project.id}/add-money`} className="inline-flex items-center gap-1.5">
                          <Plus size={14} />
                          Add Money
                        </Link>
                      </Button>
                      <Button asChild variant="ghost">
                        <Link href={`/projects/${project.id}/withdraw-money`} className="inline-flex items-center gap-1.5">
                          <Minus size={14} />
                          Withdraw Money
                        </Link>
                      </Button>
                      <Button asChild variant="ghost">
                        <Link href={`/structure/${project.id}`} className="inline-flex items-center gap-1.5">
                          <Network size={14} />
                          Structure
                        </Link>
                      </Button>
                    </div>
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
