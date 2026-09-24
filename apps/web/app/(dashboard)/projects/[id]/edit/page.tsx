"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Field, FieldHint, Input, Label, PageHeader, Textarea } from "@niveshbook/ui";
import { getProject, updateProject } from "@/lib/projects";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded" };

/**
 * Edit-Project form (Story 2.1, AC4): same fields as create, pre-filled
 * with the Project's current name/description, saved via
 * `PATCH /api/projects/[id]`. A nonexistent/malformed id renders the same
 * plain not-found state either way (`apps/web/lib/ids.ts`'s
 * malformed-id-looks-like-404 convention) rather than a raw error.
 */
export default function EditProjectPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getProject(id)
      .then((project) => {
        if (cancelled) return;
        setName(project.name);
        setDescription(project.description ?? "");
        setLoad({ status: "loaded" });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoad({
            status: "error",
            message: err instanceof Error ? err.message : "Project not found.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updateProject(id, { name, description: description.trim() ? description : null });
      router.push("/projects");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (load.status === "loading") {
    return (
      <div>
        <PageHeader title="Edit Project" />
        <p className="text-[13.4px] text-ink-soft">Loading…</p>
      </div>
    );
  }

  if (load.status === "error") {
    return (
      <div>
        <PageHeader title="Edit Project" />
        <p role="alert" className="text-[13.4px] text-danger">
          {load.message}
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Edit Project"
        description="Changes to the name or description are saved immediately."
      />

      <Card className="max-w-[520px]">
        <form onSubmit={handleSubmit}>
          <Field>
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field>
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              name="description"
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <FieldHint>Optional — leave blank to clear it.</FieldHint>
          </Field>

          {error ? (
            <p role="alert" className="mb-4 text-[13.4px] text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2.5">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save Changes"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/projects")}
              disabled={submitting}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
