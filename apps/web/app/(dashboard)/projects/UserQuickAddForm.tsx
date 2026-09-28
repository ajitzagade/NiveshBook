"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Save, X, Copy, Check } from "lucide-react";
import { Button, Field, FieldHint, Input, Label, cn, toast } from "@niveshbook/ui";
import { createUserAccount, generatePassword, type CreatableUserRole, type SanitizedUser } from "@/lib/users";

/** Best-effort clipboard copy -- mirrors `users/page.tsx`'s identical helper (some browsers/contexts don't expose `navigator.clipboard`). */
async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Password copied");
  } catch {
    toast.error("Couldn't copy automatically -- please select and copy the password manually.");
  }
}

/**
 * spec-quick-add-user-share-dialog: the inline "+ Add New User" quick-create
 * form composed into the Partner/Sub-partner Share dialog's user `Combobox`.
 * Two phases, same shape as `apps/web/app/(dashboard)/users/page.tsx`'s own
 * Create-User dialog (`DialogState`): `"form"` (name + email) then, on
 * success, `"created"` (the one-time password shown once, copyable) --
 * `onCreated` only fires once the admin clicks Done, never right after
 * `createUserAccount()` resolves, so the password is never shown-and-
 * immediately-hidden by the Combobox auto-closing (unlike `ProjectQuickAddForm`,
 * which has nothing else to show and fires immediately).
 */
export interface UserQuickAddFormProps {
  /** The dialog's own expected role (Partner dialog -> `"partner"`, Sub-partner dialog -> `"sub_partner"`) -- never caller-chosen. */
  role: CreatableUserRole;
  onCancel: () => void;
  onCreated: (user: SanitizedUser, name: string) => void;
  /** Tighter spacing for the Combobox's inline popover slot -- mirrors `ProjectQuickAddForm`'s identical `compact` contract. */
  compact?: boolean;
}

type Phase = { step: "form" } | { step: "created"; user: SanitizedUser; name: string; password: string };

export function UserQuickAddForm({ role, onCancel, onCreated, compact = false }: UserQuickAddFormProps) {
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  // Guards against `createUserAccount()` resolving after this form has
  // unmounted (the popover was dismissed before the request finished) --
  // mirrors `ProjectQuickAddForm`'s identical `mountedRef` guard.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // This form can render inside a `Combobox`'s `Popover`, itself inside
    // another `<form>` (e.g. the Partner/Sub-partner Share dialog) --
    // Portals don't change React's own event-bubbling tree, so a "submit"
    // SyntheticEvent from here still bubbles to that outer form's own
    // `onSubmit` unless stopped here. Without this, submitting this form
    // silently ALSO submits the outer Share form with whatever it currently
    // has (often blank), then closes it.
    event.stopPropagation();
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const password = generatePassword();
      const user = await createUserAccount({ email: email.trim(), password, role });
      if (!mountedRef.current) return;
      setPhase({ step: "created", user, name: name.trim(), password });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }

  if (phase.step === "created") {
    return (
      <div>
        <p className={cn("mb-2 text-[13px] text-ink-soft", compact && "text-[12.2px]")}>
          Share this password with {phase.user.email} yourself -- it won&apos;t be shown again.
        </p>
        <Field className={compact ? "mb-2.5" : undefined}>
          <Label htmlFor={passwordId}>Password</Label>
          <div className="flex gap-2">
            <Input
              id={passwordId}
              value={phase.password}
              readOnly
              autoComplete="off"
              className={cn("flex-1", compact && "py-1.5 text-[13px]")}
            />
            <Button
              type="button"
              variant="ghost"
              size={compact ? "sm" : "md"}
              onClick={() => void copyToClipboard(phase.password)}
              icon={<Copy size={compact ? 12 : 14} />}
            >
              Copy
            </Button>
          </div>
          <FieldHint>Save this now -- it won&apos;t be shown again.</FieldHint>
        </Field>
        <Button
          type="button"
          size={compact ? "sm" : "md"}
          onClick={() => onCreated(phase.user, phase.name)}
          icon={<Check size={compact ? 12 : 14} />}
        >
          Done
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Field className={compact ? "mb-2.5" : undefined}>
        <Label htmlFor={nameId}>User&apos;s name</Label>
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
        <Label htmlFor={emailId}>Email</Label>
        <Input
          id={emailId}
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className={compact ? "py-1.5 text-[13px]" : undefined}
        />
      </Field>

      {error ? (
        <p role="alert" className={cn("text-danger", compact ? "mb-2.5 text-[12px]" : "mb-4 text-[13.4px]")}>
          {error}
        </p>
      ) : null}

      {/*
        Labeled "Create User"/"Back" rather than "Save"/"Cancel" -- unlike
        `ProjectQuickAddForm` (never nested inside another form), this one
        renders inline while the outer Partner/Sub-partner dialog's own
        Save/Cancel buttons are still in the DOM, so identical labels would
        be an accessible-name collision for anyone navigating by name
        (assistive tech, `getByRole("button", { name })`). "Back" also
        reads more accurately -- this only returns to the user list, it
        doesn't cancel the Share being edited.
      */}
      <div className="flex gap-2">
        <Button
          type="submit"
          size={compact ? "sm" : "md"}
          disabled={submitting}
          icon={<Save size={compact ? 12 : 14} />}
        >
          {submitting ? "Creating…" : "Create User"}
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
