"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { InvestmentRequirement } from "@niveshbook/types";
import {
  Amount,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Field,
  Helper,
  Input,
  Label,
  Table,
  TableHead,
  TableBody,
  TableRow,
  Th,
  Td,
} from "@niveshbook/ui";
import { listInvestmentRequirements, addInvestmentRequirement } from "@/lib/investment-requirements";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; requirements: InvestmentRequirement[] };

/**
 * Add Money page (Story 3.1): one page per Project, listing every funding
 * requirement created so far (`Amount` + Date, via a `Table`) plus a
 * "+ New Requirement" `Dialog` (Amount + Date fields). Owner/Admin-only at
 * the API layer (`authorizeScope("investment_requirements:*")`) -- a
 * non-Owner/Admin sees the plain error state below, not partial data.
 * There is no edit affordance -- every requirement is a discrete,
 * never-versioned row (spec-3-1's Decisions), so this screen is
 * list-and-add only. Covers all 4 NFR8 states (loading/error/empty/
 * loaded), mirroring the Partner Shares page's established shape. This is
 * `packages/ui`'s `Amount` component's first real consumer.
 */
export default function AddMoneyPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [state, setState] = useState<ListState>({ status: "loading" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [requirementDate, setRequirementDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    const result = await listInvestmentRequirements(projectId);
    setState({ status: "loaded", requirements: result.requirements });
  }

  useEffect(() => {
    let cancelled = false;

    listInvestmentRequirements(projectId)
      .then((result) => {
        if (!cancelled) {
          setState({ status: "loaded", requirements: result.requirements });
        }
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
  }, [projectId]);

  function openAddDialog() {
    setAmount("");
    setRequirementDate("");
    setFormError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setFormError(null);
    setSubmitting(true);
    try {
      await addInvestmentRequirement(projectId, { amount, requirementDate });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    // The requirement is already saved at this point -- close the dialog
    // regardless of whether the follow-up refresh (a separate GET) below
    // succeeds. Story 3.3's idempotency keys don't exist yet, so treating a
    // refresh failure the same as a create failure would show a misleading
    // "save failed" error and could prompt the user to click Save again,
    // creating a genuine duplicate requirement.
    setSubmitting(false);
    closeDialog();
    try {
      await refresh();
    } catch {
      // Best-effort only -- the new row is already saved server-side; a
      // failed refresh just leaves the list showing its prior (stale)
      // state rather than any user-facing error.
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/projects" className="text-[12.6px] text-ink-soft hover:underline">
            ← Projects
          </Link>
          <h1 className="mt-1 text-[22px]">Add Money</h1>
          <p className="mt-1 text-[13.4px] text-ink-soft">
            Create a funding requirement for this Project -- an amount and a date. Every Partner&apos;s
            Should Pay is calculated from this once their Share % is set.
          </p>
        </div>
        <Button onClick={openAddDialog}>+ New Requirement</Button>
      </div>

      <Card>
        {state.status === "loading" ? (
          <p className="text-[13.4px] text-ink-soft">Loading funding requirements…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-[13.4px] text-danger">
            {state.message}
          </p>
        ) : state.requirements.length === 0 ? (
          <div>
            <p className="mb-3 text-[13.4px] text-ink-soft">
              No funding requirements yet. Create the first one to get started.
            </p>
            <Button variant="ghost" onClick={openAddDialog}>
              + New Requirement
            </Button>
          </div>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <Th className="!text-left">Date</Th>
                <Th>Amount</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {state.requirements.map((requirement) => (
                <TableRow key={requirement.id}>
                  <Td className="!text-left text-ink-soft">{requirement.requirementDate}</Td>
                  <Td>
                    <Amount value={requirement.amount} />
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>New Funding Requirement</DialogTitle>
          <DialogDescription>
            Owner/Admin only. Each funding round is its own new record -- a past requirement is never
            edited.
          </DialogDescription>
          <form onSubmit={handleSubmit} className="mt-4">
            <Field>
              <Label htmlFor="requirement-amount">Amount</Label>
              <Input
                id="requirement-amount"
                name="amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
                autoFocus
              />
              <Helper>e.g. 1000000 for ₹10,00,000 -- up to 2 decimal places are supported.</Helper>
            </Field>
            <Field>
              <Label htmlFor="requirement-date">Date</Label>
              <Input
                id="requirement-date"
                name="requirementDate"
                type="date"
                value={requirementDate}
                onChange={(event) => setRequirementDate(event.target.value)}
                required
              />
            </Field>

            {formError ? (
              <p role="alert" className="mb-4 text-[13.4px] text-danger">
                {formError}
              </p>
            ) : null}

            <div className="flex gap-2.5">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" onClick={closeDialog} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
