"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Users as UsersIcon, Wand2, Copy, Check, X, KeyRound, UserX, UserCheck } from "lucide-react";
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
  getCurrentUser,
  listUsers,
  resetUserPassword,
  setUserActive,
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

/**
 * The Reset Password dialog's own two-phase shape (spec-user-reset-
 * deactivate, Decision #3) -- mirrors the New User dialog's identical
 * `DialogState` shape one level over: `"form"` (type/Generate a password)
 * then, on success, `"success"` (that same password shown once more,
 * copyable, "won't be shown again").
 */
type ResetPasswordDialogState =
  | { open: false }
  | { open: true; phase: "form"; user: SanitizedUser }
  | { open: true; phase: "success"; user: SanitizedUser; password: string };

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
 * The 2 per-row actions (Reset Password, Activate/Deactivate) -- extracted
 * so the desktop Table cell and the below-860px `RowCard`'s own `action`
 * slot render the exact same buttons rather than duplicating this JSX twice,
 * mirroring `projects/page.tsx`'s `ProjectActionButtons` extraction
 * precedent one screen over.
 *
 * `isSelf` disables the Activate/Deactivate button (UI-only, spec-user-
 * reset-deactivate Decision #2's "cheap insurance beyond, not instead of,
 * the existing accepted-risk precedent" -- the API itself still honors a
 * direct call regardless). Reset Password is never disabled on your own row
 * -- resetting your own password is never accidental self-lockout the same
 * way deactivating your own account is (you'd have to type/generate and
 * submit a whole new password on purpose).
 *
 * `deactivateConfirmPending` (review fix) swaps the button's own label to a
 * second-click prompt -- the click handler itself (`handleToggleActiveClick`)
 * owns the actual two-click logic; this component only reflects that state.
 */
function UserActionButtons({
  user,
  isSelf,
  busy,
  deactivateConfirmPending,
  onResetPassword,
  onToggleActive,
}: {
  user: SanitizedUser;
  isSelf: boolean;
  busy: boolean;
  deactivateConfirmPending: boolean;
  onResetPassword: (user: SanitizedUser) => void;
  onToggleActive: (user: SanitizedUser) => void;
}) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        tone="info"
        onClick={() => onResetPassword(user)}
        icon={<KeyRound size={14} />}
      >
        Reset Password
      </Button>
      <Button
        type="button"
        variant="ghost"
        tone={user.active ? "danger" : "success"}
        onClick={() => onToggleActive(user)}
        disabled={isSelf || busy}
        icon={user.active ? <UserX size={14} /> : <UserCheck size={14} />}
      >
        {busy
          ? "Updating…"
          : user.active
            ? deactivateConfirmPending
              ? "Confirm Deactivate?"
              : "Deactivate"
            : "Activate"}
      </Button>
    </>
  );
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
  const router = useRouter();
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

  // spec-user-reset-deactivate: the caller's own id (Decision #2's UI-only
  // "disable Deactivate on my own row" safeguard) -- `null` until resolved
  // (or if `getCurrentUser()` fails, best-effort, see below), in which case
  // no row is treated as "mine" and nothing is disabled.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // The rows currently mid-PATCH (Activate/Deactivate) -- a `Set`, not a
  // single id (review fix): clicking a second row while a first row's
  // request is still in flight must not overwrite/clear the first row's own
  // busy state. Disables that row's own toggle button and swaps its label to
  // "Updating…" for the duration.
  const [togglingIds, setTogglingIds] = useState<ReadonlySet<string>>(new Set());
  // Second-click confirmation for Deactivate specifically (review fix,
  // mirrors `ownerAdminConfirmPending`'s identical two-click shape) -- never
  // for Activate, which is more benign/reversible. Holds at most one row's
  // id, so clicking a DIFFERENT row's Deactivate implicitly resets this back
  // to that row's own first click, same as `ownerAdminConfirmPending` resets
  // on role change.
  const [deactivateConfirmPendingId, setDeactivateConfirmPendingId] = useState<string | null>(null);
  const [resetDialog, setResetDialog] = useState<ResetPasswordDialogState>({ open: false });
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetFormError, setResetFormError] = useState<string | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);

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

    // Best-effort only, deliberately separate from the list fetch above --
    // this only drives the UI-only "disable Deactivate on my own row"
    // safeguard (Decision #2), never anything permission-sensitive, so a
    // failure here must never surface as the page's own error state.
    getCurrentUser()
      .then((me) => {
        if (!cancelledRef.current) setCurrentUserId(me.id);
      })
      .catch(() => {
        // Leave currentUserId null -- no row is treated as "mine", so
        // nothing gets disabled; the API's own accepted self-lockout risk
        // (Story 1.6/1.7 precedent) still applies either way.
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

  /**
   * Wires the existing, unchanged `PATCH /api/users/[id]` (Story 1.6) to a
   * row action button (Decision #2) -- the only reachability gap this spec
   * closes for that endpoint, no new backend behavior. Errors surface as a
   * toast (never a blocking dialog) since there's no form to keep open here.
   *
   * `refresh()` is awaited (review fix), not fire-and-forget, before the
   * `finally` clears this row's busy flag -- otherwise the button briefly
   * re-enables showing the stale, pre-toggle `active` value until the list
   * catches up a moment later. The unmount guard (`cancelledRef`, mirrors
   * this component's existing mount-time-fetch/`refresh()` precedent) only
   * needs to protect the `finally`'s own `setTogglingIds` call -- `toast.*`
   * isn't React state, and both success/error paths already return through
   * this one `finally`.
   */
  async function handleToggleActive(user: SanitizedUser) {
    setTogglingIds((prev) => {
      const next = new Set(prev);
      next.add(user.id);
      return next;
    });
    try {
      const updated = await setUserActive(user.id, !user.active);
      toast.success(`${updated.email} ${updated.active ? "activated" : "deactivated"}`);
      await refresh().catch(() => {
        // Best-effort only, mirrors performCreate()'s identical precedent --
        // the toggle itself already succeeded.
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      if (!cancelledRef.current) {
        setTogglingIds((prev) => {
          if (!prev.has(user.id)) return prev;
          const next = new Set(prev);
          next.delete(user.id);
          return next;
        });
      }
    }
  }

  /**
   * The click handler actually wired to the row's Activate/Deactivate button
   * (review fix) -- Deactivate requires an explicit second click before
   * `handleToggleActive` ever runs, mirroring `handleSubmit`'s identical
   * `ownerAdminConfirmPending` two-click shape one action over. Activate
   * skips straight to `handleToggleActive` -- reactivating is more benign/
   * reversible, so it never needed confirmation to begin with.
   */
  function handleToggleActiveClick(user: SanitizedUser) {
    if (user.active) {
      if (deactivateConfirmPendingId !== user.id) {
        setDeactivateConfirmPendingId(user.id);
        return;
      }
      setDeactivateConfirmPendingId(null);
    }
    void handleToggleActive(user);
  }

  function openResetDialog(user: SanitizedUser) {
    setResetPasswordValue("");
    setResetFormError(null);
    setResetDialog({ open: true, phase: "form", user });
  }

  function closeResetDialog() {
    setResetDialog({ open: false });
  }

  async function performReset(user: SanitizedUser, passwordToSet: string) {
    setResetSubmitting(true);
    try {
      const updated = await resetUserPassword({ userId: user.id, password: passwordToSet });
      // Mirrors performCreate()'s identical "fire success the instant the
      // request succeeds" shape -- a subsequent refresh() failure must never
      // land in the same catch as a genuine reset failure. Guarded by
      // `cancelledRef` (review fix), mirroring the mount-time fetch/
      // `refresh()`'s existing unmount-guard precedent -- this component's
      // own async setState calls previously had none.
      if (!cancelledRef.current) {
        setResetDialog({ open: true, phase: "success", user: updated, password: passwordToSet });
      }
      toast.success(`${updated.email}'s password reset`);
      refresh().catch(() => {
        // Best-effort only -- the reset itself already succeeded.
      });
    } catch (err) {
      if (!cancelledRef.current) {
        setResetFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      if (!cancelledRef.current) {
        setResetSubmitting(false);
      }
    }
  }

  async function handleResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResetFormError(null);

    if (!resetDialog.open || resetDialog.phase !== "form") {
      return;
    }

    // Client-side length checks, mirroring handleSubmit()'s identical
    // "caught here, no request sent" shape -- the server independently
    // re-validates both bounds (never trusted to the client alone).
    if (resetPasswordValue.length < MIN_PASSWORD_LENGTH) {
      setResetFormError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (resetPasswordValue.length > MAX_PASSWORD_LENGTH) {
      setResetFormError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
      return;
    }

    await performReset(resetDialog.user, resetPasswordValue);
  }

  // Review fix (real bug): an owner_admin resetting their OWN password
  // immediately deletes their own current session server-side (correct,
  // intended -- `resetUserPassword()`'s spec'd behavior), so the success
  // phase needs to say so and send them to sign back in, instead of the
  // generic "share this with them" copy that reads as if it's someone else's
  // account.
  const isSelfPasswordReset =
    resetDialog.open && resetDialog.phase === "success" && resetDialog.user.id === currentUserId;

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
                    {/* Pinned to the right edge (founder feedback 2026-09-27) so the action buttons never require horizontal scrolling to reach. */}
                    <Th className="nb-table-sticky-actions !text-left">Actions</Th>
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
                      <Td className="nb-table-sticky-actions !text-left">
                        <div className="flex flex-wrap gap-1.5">
                          <UserActionButtons
                            user={user}
                            isSelf={user.id === currentUserId}
                            busy={togglingIds.has(user.id)}
                            deactivateConfirmPending={deactivateConfirmPendingId === user.id}
                            onResetPassword={openResetDialog}
                            onToggleActive={handleToggleActiveClick}
                          />
                        </div>
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
                  action={
                    <UserActionButtons
                      user={user}
                      isSelf={user.id === currentUserId}
                      busy={togglingIds.has(user.id)}
                      deactivateConfirmPending={deactivateConfirmPendingId === user.id}
                      onResetPassword={openResetDialog}
                      onToggleActive={handleToggleActiveClick}
                    />
                  }
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

      {/*
        Reset Password dialog (spec-user-reset-deactivate, Decision #3) --
        mirrors the New User dialog's exact two-phase shape immediately
        above: "form" (type/Generate a password) then, on success, the same
        password shown once more, copyable, "won't be shown again".
      */}
      <Dialog
        open={resetDialog.open}
        onOpenChange={(open) => {
          // Ignore a close request (Escape/backdrop) while a reset is still
          // in flight (review fix) -- mirrors the Cancel button's own
          // `disabled={resetSubmitting}` intent, extended to dismissal:
          // otherwise a since-closed dialog could silently reopen in its
          // success phase once the in-flight request resolves.
          if (!open && !resetSubmitting) closeResetDialog();
        }}
      >
        <DialogContent>
          {resetDialog.open && resetDialog.phase === "success" ? (
            <>
              <DialogTitle>Password reset</DialogTitle>
              <DialogDescription>
                {isSelfPasswordReset ? (
                  "You've reset your own password — you'll need to sign back in with it."
                ) : (
                  <>
                    Share this password with {resetDialog.user.email} yourself -- save it now, it
                    will never be shown again after you close this. Their previous sessions have
                    already ended.
                  </>
                )}
              </DialogDescription>
              <div className="mt-4">
                <Field>
                  <Label>Email</Label>
                  <p className="text-[13.4px] font-semibold text-ink">{resetDialog.user.email}</p>
                </Field>
                <Field>
                  <Label htmlFor="reset-password-value">Password</Label>
                  <div className="flex gap-2">
                    <Input
                      id="reset-password-value"
                      name="resetPasswordValue"
                      value={resetDialog.password}
                      readOnly
                      autoComplete="off"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => void copyToClipboard(resetDialog.password)}
                      icon={<Copy size={14} />}
                    >
                      Copy
                    </Button>
                  </div>
                  <Helper>Save this now -- it won&apos;t be shown again.</Helper>
                </Field>
              </div>
              <div className="flex gap-2.5">
                <Button
                  type="button"
                  onClick={() => {
                    closeResetDialog();
                    // Own-password reset (review fix, real bug): the reset
                    // already deleted this exact session server-side, so
                    // closing the dialog alone would leave the admin looking
                    // at a dashboard whose next request 401s -- send them to
                    // sign back in immediately instead, mirroring this app's
                    // login destination (`/`, the root page renders the
                    // login form -- `getSession()` there re-validates fresh
                    // against the DB, so the just-deleted session is already
                    // gone by this navigation, force-dynamic, never cached).
                    // `router.push()`, not `window.location.href` (review
                    // fix) -- mirrors this app's own `LogoutButton`/
                    // `SessionList` navigation convention (`next/navigation`)
                    // rather than a hard reload.
                    if (isSelfPasswordReset) {
                      router.push("/");
                    }
                  }}
                  icon={<Check size={14} />}
                >
                  Done
                </Button>
              </div>
            </>
          ) : resetDialog.open ? (
            <>
              <DialogTitle>Reset Password</DialogTitle>
              <DialogDescription>
                Set a new password for {resetDialog.user.email}. This immediately ends every one of
                their active sessions -- they&apos;ll need the new password to sign in again.
              </DialogDescription>
              <form onSubmit={handleResetSubmit} className="mt-4">
                <Field>
                  <Label htmlFor="reset-password-input">New password</Label>
                  <div className="flex gap-2">
                    <Input
                      id="reset-password-input"
                      name="resetPassword"
                      type="text"
                      value={resetPasswordValue}
                      onChange={(event) => setResetPasswordValue(event.target.value)}
                      minLength={MIN_PASSWORD_LENGTH}
                      maxLength={MAX_PASSWORD_LENGTH}
                      required
                      autoComplete="off"
                      autoFocus
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setResetPasswordValue(generatePassword())}
                      icon={<Wand2 size={14} />}
                    >
                      Generate
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => void copyToClipboard(resetPasswordValue)}
                      disabled={!resetPasswordValue}
                      icon={<Copy size={14} />}
                    >
                      Copy
                    </Button>
                  </div>
                  <Helper>
                    At least {MIN_PASSWORD_LENGTH} characters, typed or generated -- visible here so
                    you can copy it before saving. Share it with them yourself; NiveshBook never
                    emails or texts it.
                  </Helper>
                </Field>

                {resetFormError ? (
                  <p role="alert" className="mb-4 text-[13.4px] text-danger">
                    {resetFormError}
                  </p>
                ) : null}

                <div className="flex gap-2.5">
                  <Button type="submit" disabled={resetSubmitting} icon={<KeyRound size={14} />}>
                    {resetSubmitting ? "Resetting…" : "Reset Password"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={closeResetDialog}
                    disabled={resetSubmitting}
                    icon={<X size={14} />}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
