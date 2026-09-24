"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, FieldHint, Input, Label, PageHeader, Textarea } from "@niveshbook/ui";
import { createProject } from "@/lib/projects";

/**
 * Create-Project form (Story 2.1, AC1/AC2): a Project saves with just a
 * name and description — no partner information required. Empty name is
 * blocked client-side (`required`) and, authoritatively, server-side by
 * `packages/core`'s `createProject` (400 `validation_error`, surfaced here).
 */
export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createProject({ name, description: description.trim() ? description : null });
      router.push("/projects");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="New Project"
        description="Create a Project with a name and description — Partner Shares are added later, in a separate step."
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
            <FieldHint>Optional — you can always edit this later.</FieldHint>
          </Field>

          {error ? (
            <p role="alert" className="mb-4 text-[13.4px] text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2.5">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save Project"}
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
