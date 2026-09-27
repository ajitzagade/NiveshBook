"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { UserPlus, Users as UsersIcon, Wand2, Copy, Check, X } from "lucide-react";
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  EmptyState,
  Field,
  Helper,
  Input,
  Label,
  PageHeader,
  RowCard,
  StatusChip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  Th,
  Td,
  toast,
} from "@niveshbook/ui";
import {
  CREATABLE_USER_ROLES,
  ROLE_LABEL,
  createUserAccount,
  generatePassword,
  listUsers,
  type CreatableUserRole,
  type SanitizedUser,
} from "@/lib/users";

const MIN_PASSWORD_LENGTH = 8;
// Mirrors the server's own cap (`apps/web/app/api/users/route.ts`) -- an
// unbounded length reaching `argon2.hash()` is a self-inflicted hashing-cost
// vector even on an Owner/Admin-only endpoint (review fix).
const MAX_PASSWORD_LENGTH = 128;
const DEFAULT_ROLE: CreatableUserRole = "partner";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; users: SanitizedUser[] };

type DialogState =
  | { open: false }
  | { open: true; phase: "form" }
  | { open: true; phase: "success"; created: SanitizedUser; password: string };

/** Best-effort clipboard copy -- some browsers/contexts (non-HTTPS, older Safari) don't expose `navigator.clipboard`, so this never throws past a toast. */
async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Password copied");
  } catch {
    toast.error("Couldn't copy automatically -- please select and copy the password manually.");
  }
}

/**
 * Users screen (spec-user-creation) -- the app's first in-app path to
 * onboard a Partner/Sub-partner (or another Owner/Admin) login account, sole
 * remaining reason the Partner Share dialog's `linkedUserEmail` field used to
 * dead-end on an unknown email. Owner/Admin-only (`users/layout.tsx`).
 *
 * Reuses `GET /api/users` unchanged for the list (Decision #4 -- no new list
 * endpoint) and covers all 4 NFR8 states (loading/error/empty/loaded),
 * mirroring `projects/page.tsx`'s exact Table + below-860px `RowCard` stack
 * pattern. The "New User" `Dialog` has two phases: `"form"` (email/role/
 * password, with a "Generate" button) and, after a successful create,
 * `"success"` (the exact same password shown once more, copyable, with an
 * explicit "won't be shown again" notice -- spec-user-creation's Boundaries:
 * the password is never persisted or retrievable after this).
 */
export default function UsersPage() {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CreatableUserRole>(DEFAULT_ROLE);
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Second-click confirmation for the most consequential creatable role
  // (review fix) -- mirrors this app's existing Extra Withdrawal precedent
  // of a distinct confirmation step for a more consequential action. Reset
  // whenever the dialog (re)opens or the role selection changes, so it can
  // never carry over stale from an earlier role/attempt.
  const [ownerAdminConfirmPending, setOwnerAdminConfirmPending] = useState(false);

  // Shared unmount guard for every `setState` this component fires from an
  // async callback -- both the mount-time fetch below AND `refresh()`
  // (called again after a successful create) check this before writing
  // state, so neither can touch a `setState` after the page has navigated
  // away (review fix: `refresh()` previously had no such guard at all).
  const cancelledRef = useRef(false);
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  async function refresh() {
    const users = await listUsers();
    if (!cancelledRef.current) {
      setState({ status: "loaded", users });
    }
  }

  useEffect(() => {
    listUsers()
      .then((users) => {
        if (!cancelledRef.current) setState({ status: "loaded", users });
      })
      .catch((error: unknown) => {
        if (!cancelledRef.current) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Something went wrong.",
          });
        }
      });
  }, []);

  function openDialog() {
    setEmail("");
    setRole(DEFAULT_ROLE);
    setPassword("");
    setFormError(null);
    setOwnerAdminConfirmPending(false);
    setDialog({ open: true, phase: "form" });
  }

  function closeDialog() {
    setDialog({ open: false });
  }

  async function performCreate() {
    setSubmitting(true);
    try {
      const created = await createUserAccount({ email, password, role });
      // Fire the success state the instant creation succeeds -- a
      // subsequent `refresh()` failure must never land in the same catch as
      // a genuine create failure (review fix), which would otherwise tell
      // the admin "something went wrong" for an action that actually
      // succeeded and hide the one-time password.
      setDialog({ open: true, phase: "success", created, password });
      toast.success(`${created.email} created`);
      refresh().catch(() => {
        // Best-effort only -- the list is simply one row stale until the
        // admin reloads or reopens the dialog; the create itself already
        // succeeded and is already reflected in the success state above.
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    // Client-side length checks -- caught here, no request sent (this
    // spec's I/O matrix: "Password too short ... no request sent if caught
    // client-side"). The server independently re-validates both bounds
    // (never trusted to the client alone).
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      setFormError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
      return;
    }

    // Owner/Admin is the most consequential creatable role -- require an
    // explicit second click before it actually submits (review fix).
    // Submitting again with `ownerAdminConfirmPending` already true (the
    // button's own label changes to make this an intentional second click,
    // not an accidental double-submit) proceeds to the real create below.
    if (role === "owner_admin" && !ownerAdminConfirmPending) {
      setOwnerAdminConfirmPending(true);
      return;
    }

    await performCreate();
  }

  return (
    <div>
      <PageHeader
        title="Users"
        description="Create login accounts for a Partner or Sub-partner so they can sign in themselves. Link an account to a Partner/Sub-partner Share from the Partner Shares screen afterward."
        action={
          <Button onClick={openDialog} icon={<UserPlus size={14} />}>
            New User
          </Button>
        }
      />

      <Card>
        {state.status === "loading" ? (
          <p className="text-[13.4px] text-ink-soft">Loading Users…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.users.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={22} />}
            title="No Users yet"
            description="Create the first login account so a Partner or Sub-partner can sign in themselves."
            action={
              <Button variant="ghost" tone="info" onClick={openDialog} icon={<UserPlus size={14} />}>
                New User
              </Button>
            }
          />
        ) : (
          <>
            <div className="max-[860px]:hidden">
              <Table>
                <TableHead>
                  <TableRow>
                    <Th className="!text-left">Email</Th>
                    <Th className="!text-left">Role</Th>
                    <Th className="!text-left">Status</Th>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {state.users.map((user) => (
                    <TableRow key={user.id}>
                      <Td className="!text-left font-semibold">{user.email}</Td>
                      <Td className="!text-left text-ink-soft">{ROLE_LABEL[user.role]}</Td>
                      <Td className="!text-left">
                        <StatusChip variant={user.active ? "success" : "neutral"}>
                          {user.active ? "Active" : "Inactive"}
                        </StatusChip>
                      </Td>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="hidden max-[860px]:block" data-testid="users-row-cards">
              {state.users.map((user) => (
                <RowCard
                  key={user.id}
                  title={user.email}
                  fields={[
                    { label: "Role", value: ROLE_LABEL[user.role] },
                    {
                      label: "Status",
                      value: (
                        <StatusChip variant={user.active ? "success" : "neutral"}>
                          {user.active ? "Active" : "Inactive"}
                        </StatusChip>
                      ),
                    },
                  ]}
                />
              ))}
            </div>
          </>
        )}
      </Card>

      <Dialog
        open={dialog.open}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          {dialog.open && dialog.phase === "success" ? (
            <>
              <DialogTitle>User created</DialogTitle>
              <DialogDescription>
                Share this password with {dialog.created.email} yourself -- save it now, it will never
                be shown again after you close this.
              </DialogDescription>
              <div className="mt-4">
                <Field>
                  <Label>Email</Label>
                  <p className="text-[13.4px] font-semibold text-ink">{dialog.created.email}</p>
                </Field>
                <Field>
                  <Label>Role</Label>
                  <p className="text-[13.4px] font-semibold text-ink">{ROLE_LABEL[dialog.created.role]}</p>
                </Field>
                <Field>
                  <Label htmlFor="created-password">Password</Label>
                  <div className="flex gap-2">
                    <Input
                      id="created-password"
                      name="createdPassword"
                      value={dialog.password}
                      readOnly
                      autoComplete="off"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => void copyToClipboard(dialog.password)}
                      icon={<Copy size={14} />}
                    >
                      Copy
                    </Button>
                  </div>
                  <Helper>Save this now -- it won&apos;t be shown again.</Helper>
                </Field>
              </div>
              <div className="flex gap-2.5">
                <Button type="button" onClick={closeDialog} icon={<Check size={14} />}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogTitle>New User</DialogTitle>
              <DialogDescription>
                Create a login account, then link it to a Partner or Sub-partner from the Partner Shares
                screen&apos;s &quot;Linked user (email)&quot; field.
              </DialogDescription>
              <form onSubmit={handleSubmit} className="mt-4">
                <Field>
                  <Label htmlFor="new-user-email">Email</Label>
                  <Input
                    id="new-user-email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    autoFocus
                    autoComplete="off"
                  />
                </Field>
                <Field>
                  <Label htmlFor="new-user-role">Role</Label>
                  <select
                    id="new-user-role"
                    name="role"
                    className="w-full rounded-el border border-border bg-surface px-3 py-2.5 text-[14px] text-ink focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft"
                    value={role}
                    onChange={(event) => {
                      // Any role change (including re-selecting owner_admin
                      // later) resets the confirmation -- it never carries
                      // over stale from an earlier selection.
                      setOwnerAdminConfirmPending(false);
                      setRole(event.target.value as CreatableUserRole);
                    }}
                  >
                    {CREATABLE_USER_ROLES.map((option) => (
                      <option key={option} value={option}>
                        {ROLE_LABEL[option]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <Label htmlFor="new-user-password">Password</Label>
                  <div className="flex gap-2">
                    <Input
                      id="new-user-password"
                      name="password"
                      type="text"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      minLength={MIN_PASSWORD_LENGTH}
                      maxLength={MAX_PASSWORD_LENGTH}
                      required
                      autoComplete="off"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setPassword(generatePassword())}
                      icon={<Wand2 size={14} />}
                    >
                      Generate
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => void copyToClipboard(password)}
                      disabled={!password}
                      icon={<Copy size={14} />}
                    >
                      Copy
                    </Button>
                  </div>
                  <Helper>
                    At least {MIN_PASSWORD_LENGTH} characters, typed or generated -- visible here so you
                    can copy it before saving. Share it with them yourself; NiveshBook never emails or
                    texts it.
                  </Helper>
                </Field>

                {ownerAdminConfirmPending ? (
                  <p className="mb-4 text-[13.4px] font-semibold text-ink">
                    This creates another Owner/Admin account with full access. Continue?
                  </p>
                ) : null}

                {formError ? (
                  <p role="alert" className="mb-4 text-[13.4px] text-danger">
                    {formError}
                  </p>
                ) : null}

                <div className="flex gap-2.5">
                  <Button type="submit" disabled={submitting} icon={<UserPlus size={14} />}>
                    {submitting
                      ? "Creating…"
                      : ownerAdminConfirmPending
                        ? "Yes, Create Owner/Admin"
                        : "Create"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={closeDialog}
                    disabled={submitting}
                    icon={<X size={14} />}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
