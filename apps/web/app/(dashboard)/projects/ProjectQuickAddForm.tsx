"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Save, X } from "lucide-react";
import type { Project } from "@niveshbook/types";
import { Button, Field, FieldHint, Input, Label, Textarea, cn, toast } from "@niveshbook/ui";
import { createProject } from "@/lib/projects";

/**
 * Create-Project form (Story 2.1, AC1/AC2 -- extracted by
 * spec-quick-add-project-user-modals so `/projects/new` and every
 * Combobox's inline "+ Add New Project" quick-add row share one
 * implementation instead of forking a second copy). A Project saves with
 * just a name and description -- no partner information required. Empty
 * name is blocked client-side (`required`) and, authoritatively, server-side
 * by `packages/core`'s `createProject` (400 `validation_error`, surfaced
 * here inline, form stays open). Byte-for-byte the same field set/validation
 * as before this extraction (this spec's Boundaries: "Match
 * `projects/new/page.tsx`'s existing field set exactly").
 */
export interface ProjectQuickAddFormProps {
  onCancel: () => void;
  onCreated: (project: Project) => void;
  /**
   * Tighter spacing/smaller controls for the Combobox's inline popover slot
   * (204-240px wide) -- the full `/projects/new` page keeps the original,
   * roomier spacing. Same two fields either way.
   */
  compact?: boolean;
}

export function ProjectQuickAddForm({ onCancel, onCreated, compact = false }: ProjectQuickAddFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Instance-scoped, not a fixed literal -- this form mounts independently
  // inside every Combobox's popover (sidebar switcher, Money History filter,
  // plus `/projects/new`), so a fixed id would collide if more than one of
  // those ever rendered its inline form at once.
  const nameId = useId();
  const descriptionId = useId();
  // Guards `onCreated` (and the state below the request) against a
  // `createProject()` resolving after this form has unmounted -- e.g. the
  // user submits, then dismisses the popover (outside click/Escape) before
  // the network response arrives. Without this, `onCreated` would still fire
  // into the still-mounted `Combobox`, silently re-selecting/navigating to
  // the new Project after the user had already backed out.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // spec-quick-add-user-share-dialog (review fix, applies here too): this
    // form can render inside a `Combobox`'s `Popover`, itself inside another
    // `<form>` -- Portals don't change React's own event-bubbling tree, so a
    // "submit" SyntheticEvent from here still bubbles to any outer form's
    // `onSubmit` unless stopped here.
    event.stopPropagation();
    // Blocked client-side (this spec's I/O matrix) -- the Input's own
    // `required` attribute already stops a literally-empty submit; this
    // extra check catches whitespace-only names too, before ever reaching
    // the network. If somehow bypassed, `packages/core`'s `createProject`
    // rejects it server-side (`InvalidProjectNameError`), surfaced below by
    // the catch block -- same message, same "form stays open" behavior.
    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const project = await createProject({ name, description: description.trim() ? description : null });
      if (!mountedRef.current) return;
      toast.success(`Project "${project.name}" created`);
      onCreated(project);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field className={compact ? "mb-2.5" : undefined}>
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoFocus
          className={compact ? "py-1.5 text-[13px]" : undefined}
        />
      </Field>
      <Field className={compact ? "mb-2.5" : undefined}>
        <Label htmlFor={descriptionId}>Description</Label>
        <Textarea
          id={descriptionId}
          name="description"
          rows={compact ? 2 : 4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={compact ? "text-[13px]" : undefined}
        />
        <FieldHint>Optional — you can always edit this later.</FieldHint>
      </Field>

      {error ? (
        <p role="alert" className={cn("text-danger", compact ? "mb-2.5 text-[12px]" : "mb-4 text-[13.4px]")}>
          {error}
        </p>
      ) : null}

      {/*
        Labeled "Create Project"/"Back" rather than "Save"/"Cancel" -- this
        form now also renders inline inside the withdraw-money/available-
        balance destination-Project pickers (spec-quick-add-project-user-
        modals follow-up), both already inside a dialog with their own
        "Save" button -- identical labels would be an accessible-name
        collision for anyone navigating by name (assistive tech,
        `getByRole("button", { name })`), mirroring `UserQuickAddForm`'s
        identical "Create User"/"Back" rename for the same reason.
      */}
      <div className="flex gap-2">
        <Button
          type="submit"
          size={compact ? "sm" : "md"}
          disabled={submitting}
          icon={<Save size={compact ? 12 : 14} />}
        >
          {submitting ? "Creating…" : "Create Project"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size={compact ? "sm" : "md"}
          onClick={onCancel}
          disabled={submitting}
          icon={<X size={compact ? 12 : 14} />}
        >
          Back
        </Button>
      </div>
    </form>
  );
}

