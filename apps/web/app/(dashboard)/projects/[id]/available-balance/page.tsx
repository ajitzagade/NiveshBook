"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Save, Wallet, X } from "lucide-react";
import type { Project } from "@niveshbook/types";
import {
  Amount,
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
  Table,
  TableHead,
  TableBody,
  TableRow,
  Th,
  Td,
  toast,
  formatAmount,
} from "@niveshbook/ui";
import {
  listAvailableBalances,
  spendAvailableBalance,
  type AvailableBalancePartnerEntry,
  type AvailableBalanceSubPartnerEntry,
} from "@/lib/available-balances";
import { listProjects } from "@/lib/projects";
import {
  DestinationRequirementAndSharePickers,
  useDestinationProjectData,
  type DestinationProjectDataState,
  type DestinationSharePickerFields,
} from "../destination-picker";

type BalancesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; partners: AvailableBalancePartnerEntry[] };

type ProjectsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; projects: Project[] };

interface UseBalanceTarget {
  partyType: "partner" | "sub_partner";
  shareId: string;
  name: string;
  /** The row's balance at the moment the dialog opened -- display/client-validation only, never itself submitted; the server's own row-locked debit (AD-10) is the sole authoritative sufficiency check either way. */
  balance: string;
}

/**
 * Digit-by-digit accumulation, never `parseFloat`/`Number()` -- mirrors
 * `packages/core/src/decimal-math.ts`'s identical `digitsToInt` helper and
 * `withdraw-money/page.tsx`'s own local copy of it one screen over (this
 * story's Implementation Notes: this small decimal-compare helper is
 * duplicated per-page in this codebase, not extracted -- only
 * `DestinationRequirementAndSharePickers`'s heavier fetch/picker logic was
 * pulled into a shared module, per this story's Code Map).
 */
function digitsToInt(digits: string): number {
  let value = 0;
  for (const char of digits) {
    value = value * 10 + (char.charCodeAt(0) - 48);
  }
  return value;
}

/** Scales a plain decimal string (up to 2 fractional digits) to an integer -- mirrors `withdraw-money/page.tsx`'s `scaleMoneyForCompare`. Returns `0` for anything that doesn't match a bare non-negative decimal (a value mid-edit) rather than throwing -- client-side UX nicety only, never authoritative (the server's own `toMoney`/row-locked debit is). */
function scaleMoneyForCompare(raw: string): number {
  const trimmed = raw.trim();
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return 0;
  const [, wholePart, fractionPart = ""] = match;
  return digitsToInt(wholePart as string) * 100 + digitsToInt((fractionPart as string).padEnd(2, "0"));
}

/** `true` if `amount` is a positive number that does not exceed `balance` -- the client-side gate on Save; the server re-validates both independently (AD-10). */
function isSpendAmountValid(amount: string, balance: string): boolean {
  const scaledAmount = scaleMoneyForCompare(amount);
  return scaledAmount > 0 && scaledAmount <= scaleMoneyForCompare(balance);
}

/**
 * Available Balance page (Story 4.9, FR29): Project-scoped ledger of every
 * current Partner/Sub-partner's balance credited via a withdrawal's
 * `"available_balance"` destination-allocation leg (Story 4.7/4.8), plus a
 * "Use Balance" spend action per row -- "Invest in a Project" (reuses
 * `DestinationRequirementAndSharePickers`, extracted from
 * `withdraw-money/page.tsx` in this same story) or "Give to a Person"
 * (free-text name, mirrors Story 4.7's `"person"` leg -- no Person entity
 * exists). Covers all 4 NFR8 states (loading/error/empty/loaded).
 */
export default function AvailableBalancePage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [state, setState] = useState<BalancesState>({ status: "loading" });
  const [projectsState, setProjectsState] = useState<ProjectsState>({ status: "loading" });
  const { destinationProjectData, ensureDestinationProjectData } = useDestinationProjectData();

  const [target, setTarget] = useState<UseBalanceTarget | null>(null);
  const [destinationType, setDestinationType] = useState<"project" | "person">("person");
  const [amount, setAmount] = useState("");
  const [destinationProjectId, setDestinationProjectId] = useState("");
  const [destinationRequirementId, setDestinationRequirementId] = useState("");
  const [destinationShareId, setDestinationShareId] = useState("");
  const [destinationPartyType, setDestinationPartyType] = useState<"partner" | "sub_partner" | "">("");
  const [personName, setPersonName] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Minted once per dialog-open, mirroring `withdraw-money/page.tsx`'s
  // `allocationIdempotencyKey`'s identical caller-owns-the-key-lifecycle
  // contract.
  const [idempotencyKey, setIdempotencyKey] = useState("");

  async function refreshBalances() {
    try {
      const result = await listAvailableBalances(projectId);
      setState({ status: "loaded", partners: result.partners });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }

  useEffect(() => {
    // `refreshBalances` is a component-scoped function whose body sets
    // state -- the `react-hooks/set-state-in-effect` lint rule flags a
    // direct call to one as if it happened synchronously in the effect;
    // nesting the call inside an async IIFE satisfies the rule, mirroring
    // `withdraw-money/page.tsx`'s identical `refreshAdjustments` precedent.
    void (async () => {
      await refreshBalances();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function openUseBalanceDialog(target: UseBalanceTarget) {
    setTarget(target);
    setDestinationType("person");
    setAmount("");
    setDestinationProjectId("");
    setDestinationRequirementId("");
    setDestinationShareId("");
    setDestinationPartyType("");
    setPersonName("");
    setNotes("");
    setFormError(null);
    setIdempotencyKey(crypto.randomUUID());
    if (projectsState.status !== "loaded") {
      listProjects()
        .then((projects) => setProjectsState({ status: "loaded", projects }))
        .catch((error: unknown) => {
          setProjectsState({
            status: "error",
            message: error instanceof Error ? error.message : "Something went wrong.",
          });
        });
    }
  }

  function closeUseBalanceDialog() {
    setTarget(null);
    setFormError(null);
  }

  function handlePickerChange(patch: Partial<DestinationSharePickerFields>) {
    if (patch.destinationRequirementId !== undefined) setDestinationRequirementId(patch.destinationRequirementId);
    if (patch.destinationShareId !== undefined) setDestinationShareId(patch.destinationShareId);
    if (patch.destinationPartyType !== undefined) setDestinationPartyType(patch.destinationPartyType);
  }

  const pickerFields: DestinationSharePickerFields = {
    destinationRequirementId,
    destinationShareId,
    destinationPartyType,
  };

  const amountValid = target !== null && isSpendAmountValid(amount, target.balance);
  const destinationComplete =
    destinationType === "person"
      ? personName.trim().length > 0
      : destinationProjectId.trim().length > 0 &&
        destinationRequirementId.trim().length > 0 &&
        destinationShareId.trim().length > 0 &&
        destinationPartyType.trim().length > 0;
  const canSubmit = amountValid && destinationComplete && !submitting;

  const projectOptions = projectsState.status === "loaded" ? projectsState.projects : [];
  const projectsError = projectsState.status === "error" ? projectsState.message : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || !canSubmit) return;

    setFormError(null);
    setSubmitting(true);
    try {
      await spendAvailableBalance(
        projectId,
        {
          partyType: target.partyType,
          shareId: target.shareId,
          destinationType,
          amount,
          notes: notes.trim().length > 0 ? notes.trim() : null,
          destinationProjectId: destinationType === "project" ? destinationProjectId : null,
          destinationRequirementId: destinationType === "project" ? destinationRequirementId : null,
          destinationShareId: destinationType === "project" ? destinationShareId : null,
          destinationPartyType: destinationType === "project" && destinationPartyType ? destinationPartyType : null,
          personName: destinationType === "person" ? personName.trim() : null,
        },
        idempotencyKey,
      );
      toast.success(`${formatAmount(amount)} spent from ${target.name}'s Available Balance`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    closeUseBalanceDialog();
    await refreshBalances().catch(() => {});
  }

  return (
    <div>
      <PageHeader
        backHref="/projects"
        backLabel="Projects"
        title="Available Balance"
        description="Money withdrawn and allocated to Available Balance (Story 4.7) sits here until it's spent -- reinvested in another Project or given to a person."
      />

      <Card>
        {state.status === "loading" ? (
          <p className="text-[13.4px] text-ink-soft">Loading Available Balance…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.partners.length === 0 ? (
          <EmptyState
            icon={<Wallet size={22} />}
            title="No Partner Shares yet"
            description="Add Partner Shares for this Project before an Available Balance can be tracked."
          />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <Th className="!text-left">Name</Th>
                <Th>Balance</Th>
                <Th className="!text-left">Actions</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {state.partners.map((partner) => (
                <Fragment key={partner.partnerId}>
                  <BalanceRow
                    name={partner.name}
                    balance={partner.balance}
                    onUseBalance={() =>
                      openUseBalanceDialog({
                        partyType: "partner",
                        shareId: partner.partnerId,
                        name: partner.name,
                        balance: partner.balance,
                      })
                    }
                  />
                  {partner.subPartners.map((sub: AvailableBalanceSubPartnerEntry) => (
                    <BalanceRow
                      key={sub.subPartnerId}
                      subRow
                      name={`↳ ${sub.name}`}
                      balance={sub.balance}
                      onUseBalance={() =>
                        openUseBalanceDialog({
                          partyType: "sub_partner",
                          shareId: sub.subPartnerId,
                          name: sub.name,
                          balance: sub.balance,
                        })
                      }
                    />
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) closeUseBalanceDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>Use Balance{target ? ` — ${target.name}` : ""}</DialogTitle>
          <DialogDescription>
            {target ? (
              <>
                Current balance: <Amount value={target.balance} size="sm" />. Spend part or all of it --
                reinvest in a Project (this or another one) or give it to a person. Saved with an audit
                record (AD-5).
              </>
            ) : null}
          </DialogDescription>

          <form onSubmit={handleSubmit} className="mt-4">
            <Field>
              <Label htmlFor="ub-destination-type">Destination</Label>
              <select
                id="ub-destination-type"
                className="w-full rounded-el border border-border bg-surface px-3 py-2.5 text-[14px] text-ink focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft"
                value={destinationType}
                onChange={(event) => {
                  const value = event.target.value as "project" | "person";
                  setDestinationType(value);
                  setDestinationProjectId("");
                  setDestinationRequirementId("");
                  setDestinationShareId("");
                  setDestinationPartyType("");
                  setPersonName("");
                }}
              >
                <option value="person">Give to a Person</option>
                <option value="project">Invest in a Project</option>
              </select>
            </Field>

            <Field>
              <Label htmlFor="ub-amount">Amount</Label>
              <Input
                id="ub-amount"
                name="amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
                autoFocus
              />
              <Helper>
                {target ? (
                  <>
                    Up to <Amount value={target.balance} size="sm" /> -- the current balance.
                  </>
                ) : null}
              </Helper>
              {amount.trim().length > 0 && !amountValid ? (
                <p role="alert" className="mt-1 text-[12.6px] text-danger">
                  Amount must be greater than zero and not exceed the current balance.
                </p>
              ) : null}
            </Field>

            {destinationType === "project" ? (
              <Field>
                <Label htmlFor="ub-destination-project">Destination Project</Label>
                <select
                  id="ub-destination-project"
                  className="w-full rounded-el border border-border bg-surface px-3 py-2.5 text-[14px] text-ink focus:border-accent focus:outline focus:outline-2 focus:outline-accent-soft"
                  value={destinationProjectId}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDestinationProjectId(value);
                    setDestinationRequirementId("");
                    setDestinationShareId("");
                    setDestinationPartyType("");
                    if (value) ensureDestinationProjectData(value);
                  }}
                >
                  <option value="">Select a Project…</option>
                  {projectOptions.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                {projectsError ? (
                  <p role="alert" className="mt-1 text-[12.6px] text-danger">
                    Couldn&apos;t load Projects: {projectsError}
                  </p>
                ) : null}

                {destinationProjectId ? (
                  <DestinationRequirementAndSharePickers
                    rowLabel="destination"
                    leg={pickerFields}
                    projectName={
                      projectOptions.find((project) => project.id === destinationProjectId)?.name ??
                      "This Project"
                    }
                    data={
                      destinationProjectData[destinationProjectId] as DestinationProjectDataState | undefined
                    }
                    onChange={handlePickerChange}
                  />
                ) : null}
              </Field>
            ) : (
              <Field>
                <Label htmlFor="ub-person-name">Person&apos;s name</Label>
                <Input
                  id="ub-person-name"
                  value={personName}
                  onChange={(event) => setPersonName(event.target.value)}
                  required
                />
              </Field>
            )}

            <Field>
              <Label htmlFor="ub-notes">Notes</Label>
              <Input id="ub-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
              <Helper>Optional.</Helper>
            </Field>

            {formError ? (
              <p role="alert" className="mb-4 text-[13.4px] text-danger">
                {formError}
              </p>
            ) : null}

            <div className="flex gap-2.5">
              <Button type="submit" disabled={!canSubmit} icon={<Save size={14} />}>
                {submitting ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={closeUseBalanceDialog}
                disabled={submitting}
                icon={<X size={14} />}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * One Partner/Sub-partner's balance row -- `subRow` indents via
 * `packages/ui`'s `TableRow` prop, mirroring `withdraw-money/page.tsx`'s
 * `ShareRow` indentation one component down. "Use Balance" is disabled at a
 * `"0"` balance (this story's Code Map).
 */
function BalanceRow({
  name,
  balance,
  subRow = false,
  onUseBalance,
}: {
  name: string;
  balance: string;
  subRow?: boolean;
  onUseBalance: () => void;
}) {
  const isZero = scaleMoneyForCompare(balance) === 0;
  return (
    <TableRow subRow={subRow}>
      <Td className="!text-left">{name}</Td>
      <Td>
        <Amount value={balance} size={subRow ? "sm" : undefined} />
      </Td>
      <Td className="!text-left">
        <Button variant="ghost" tone="violet" onClick={onUseBalance} disabled={isZero} icon={<Wallet size={14} />}>
          Use Balance
        </Button>
      </Td>
    </TableRow>
  );
}
