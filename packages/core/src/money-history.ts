import type {
  AdjustmentNetting,
  AvailableBalanceSpend,
  InvestmentTransaction,
  MoneyHistoryEntry,
  MoneyHistoryEntryType,
  MoneyMovement,
  PartnerShare,
  SubPartnerShare,
  UserRole,
  WithdrawalDestinationAllocation,
  WithdrawalTransaction,
} from "@niveshbook/types";

/**
 * Story 5.1 (FR31): the actor's own scope across the whole unified Money
 * History list assembly -- a genuinely new shape from `authorize.ts`'s
 * existing `SELF_ACCESS_ACTIONS`/`SCOPE_SELF_ACCESS_ACTIONS` mechanisms
 * (both shaped for "does actor own *this one* target resource," not "what's
 * actor's scope across a *list assembly*"), per spec-5-1's Decisions #1.
 * `unrestricted: true` for `owner_admin` -- every entry across every
 * Project. `unrestricted: false` carries the exact set of `(partyType,
 * shareId, projectId)` triples the actor's own current Partner/Sub-partner
 * Shares match, keyed by `moneyHistoryShareKey` -- mirrors Story 4.10's
 * `available_balance_pool` synthetic-id precedent
 * (`` `${partyType}:${shareId}:${projectId}` ``) one level over.
 */
export type MoneyHistoryScope =
  | { unrestricted: true }
  | { unrestricted: false; shareKeys: ReadonlySet<string> };

/**
 * Builds the `shareKeys`/entry-scoping key -- shared by
 * `resolveMoneyHistoryScope` (building the actor's own set) and
 * `assembleMoneyHistory` (checking each entry against it), so the two can
 * never drift out of sync on key shape. Exported (Story 5.3) so
 * `adjust-next-time.ts`'s `filterAdjustNextTimeByScope` can check an
 * `InvestmentAdjustment`/`WithdrawalAdjustment` row against a
 * `MoneyHistoryScope` using the identical key convention, rather than
 * re-deriving a second, duplicate key-builder for a scope shape this module
 * already owns (spec-5-3's Code Map: "no new scope-resolution logic").
 */
export function moneyHistoryShareKey(
  partyType: "partner" | "sub_partner",
  shareId: string,
  projectId: string,
): string {
  return `${partyType}:${shareId}:${projectId}`;
}

/**
 * Resolves the actor's own Money History scope (Story 5.1, FR31) -- pure,
 * no DB access (AD-9). `owner_admin` always resolves unrestricted, without
 * even needing `allPartnerShares`/`allSubPartnerShares` (the route may pass
 * `[]` for this branch to skip the fetch entirely -- this function doesn't
 * care either way).
 *
 * For `partner`/`sub_partner` (or any other non-`owner_admin` role, though
 * `authorize.ts`'s gate never lets one reach this point): filters BOTH share
 * lists to rows whose `userId` case-insensitively matches `actorUserId`
 * (mirrors `authorize.ts`'s existing case-insensitive `ownerId` comparison
 * convention) -- not just the list matching the actor's own role, since
 * nothing prevents the same `userId` from being linked to both a Partner
 * Share and a Sub-partner Share row across different Projects, and every
 * one of the actor's own linked shares should count toward their own scope
 * regardless of which table it lives in.
 */
export function resolveMoneyHistoryScope(
  actorRole: UserRole,
  actorUserId: string,
  allPartnerShares: readonly PartnerShare[],
  allSubPartnerShares: readonly SubPartnerShare[],
): MoneyHistoryScope {
  if (actorRole === "owner_admin") {
    return { unrestricted: true };
  }

  const shareKeys = new Set<string>();
  for (const share of allPartnerShares) {
    if (share.userId && share.userId.toLowerCase() === actorUserId.toLowerCase()) {
      shareKeys.add(moneyHistoryShareKey("partner", share.partnerId, share.projectId));
    }
  }
  for (const share of allSubPartnerShares) {
    if (share.userId && share.userId.toLowerCase() === actorUserId.toLowerCase()) {
      shareKeys.add(moneyHistoryShareKey("sub_partner", share.subPartnerId, share.projectId));
    }
  }
  return { unrestricted: false, shareKeys };
}

/** Every filter `GET /api/money-history` accepts (Story 5.1, FR31) -- applied as an AND, never an OR (this story's I/O matrix). */
export interface MoneyHistoryFilters {
  /** Inclusive lower bound, `YYYY-MM-DD` -- compared lexically against `MoneyHistoryEntry.date` (safe: both are the same zero-padded ISO date shape). */
  dateFrom?: string;
  /** Inclusive upper bound, `YYYY-MM-DD`. */
  dateTo?: string;
  projectId?: string;
  partyType?: "partner" | "sub_partner";
  shareId?: string;
  /** Case-insensitive substring match against `MoneyHistoryEntry.personName` -- an entry with `personName: null` never matches a non-empty filter. */
  personName?: string;
}

/**
 * Every already-fetched raw row list `assembleMoneyHistory()` needs (Story
 * 5.1, FR31) -- mirrors `MoneyTrailDeps`'s "pure function, pre-fetched data"
 * shape (AD-9), except this is a flat, batched assembly rather than a
 * per-row recursive walk (this story's Boundaries: reuses
 * `money-trail.ts`/`money-trail-reconciliation.ts`'s established FK-
 * relationship *knowledge*, never a call into `assembleMoneyTrail()`
 * itself).
 *
 * `partnerNamesById`/`subPartnerNamesById` (current versions only) resolve
 * `MoneyHistoryEntry.personName` -- the display name of the Partner/
 * Sub-partner an entry's `(partyType, shareId)` is about, mirroring every
 * other screen's existing "resolve a stable share id to its current name"
 * convention (e.g. the Add Money page's `ShareRow` names). This is an
 * intentional, documented widening of spec-5-1's original Code Map (which
 * only listed `projectNamesById`) -- the AC's literal "Person" column has no
 * other data source: a `"given_to_person"` entry's own free-text
 * `personName` already fills its own `to` field (the I/O matrix), so
 * `personName` here is reserved for "whose Should Pay/Can Take this event is
 * about," consistent across every entry type. See this story's
 * Implementation Notes.
 *
 * Keyed by `` `${shareId}:${projectId}` `` (review round 2), NOT by `shareId`
 * alone -- `PartnerShare.name`/`SubPartnerShare.name` are stored per-*row*
 * (per Project), and nothing in this schema enforces the same `partnerId`
 * carries the same `name` across every Project it has a Share on. A
 * `shareId`-only key would silently collapse to whichever row
 * `Object.fromEntries` happened to iterate last, showing that one name for
 * every entry regardless of which Project it actually came from -- this
 * composite key mirrors the `` `${partyType}:${shareId}:${projectId}` ``
 * pattern `moneyHistoryShareKey`/Story 4.10's `available_balance_pool` node
 * id already establish (here `partyType` is implicit in which of the two
 * maps is consulted, so only `shareId`/`projectId` need to be in the key
 * itself).
 */
export interface MoneyHistoryRawData {
  investmentTransactions: readonly InvestmentTransaction[];
  withdrawalTransactions: readonly WithdrawalTransaction[];
  withdrawalDestinationAllocations: readonly WithdrawalDestinationAllocation[];
  moneyMovements: readonly MoneyMovement[];
  availableBalanceSpends: readonly AvailableBalanceSpend[];
  /**
   * Story 5.3 (FR33/FR34, AD-4): every `AdjustmentNetting` audit record --
   * optional (defaults to `[]` when omitted) so every pre-Story-5.3 caller
   * of `assembleMoneyHistory()`/construction of this type keeps compiling
   * unchanged, mirroring this codebase's established non-breaking-additive-
   * field convention (e.g. `withdrawal_destination_allocations`'
   * `destinationRequirementId`/`destinationShareId`/`destinationPartyType`,
   * Story 4.8). `GET /api/money-history`'s route is the one real caller that
   * now always supplies it.
   */
  adjustmentNettings?: readonly AdjustmentNetting[];
  projectNamesById: Readonly<Record<string, string>>;
  partnerNamesById: Readonly<Record<string, string>>;
  subPartnerNamesById: Readonly<Record<string, string>>;
}

const UNKNOWN_PROJECT_NAME = "Unknown Project";

function resolveProjectName(projectId: string, projectNamesById: Readonly<Record<string, string>>): string {
  return projectNamesById[projectId] ?? UNKNOWN_PROJECT_NAME;
}

/** Builds the `partnerNamesById`/`subPartnerNamesById` lookup key -- shared by the route (building the map) and this module (reading it), so the two can never drift out of sync on key shape. Exported for the route's own map-building use. */
export function moneyHistoryPersonNameKey(shareId: string, projectId: string): string {
  return `${shareId}:${projectId}`;
}

function resolvePersonName(
  partyType: "partner" | "sub_partner",
  shareId: string,
  projectId: string,
  raw: MoneyHistoryRawData,
): string | null {
  const table = partyType === "partner" ? raw.partnerNamesById : raw.subPartnerNamesById;
  return table[moneyHistoryPersonNameKey(shareId, projectId)] ?? null;
}

/**
 * Builds every `investment_transactions` row's Money History entry --
 * `"money_added"`, always. Classifies each row as a plain manual entry
 * (`from: null`) or a cross-Project movement destination (`from`: the
 * movement's source Project's name) via `movementsByDestinationTxId`, a
 * `Map` of `money_movements` keyed by `destinationInvestmentTransactionId`
 * built once by the caller -- mirrors the Add Money page's existing "Moved
 * from Project A" `money_movements.findByDestinationInvestmentTransactionId`-equivalent
 * lookup (Story 4.8), reusing that FK-relationship *knowledge*, one level
 * over (spec-5-1's Boundaries). Every row is included regardless of
 * `status` (`"active"`/`"cancelled"`) -- mirrors `listByRequirementId`'s own
 * "every row, callers filter status themselves if they need to" convention;
 * `status`/`reversalOfTransactionId` are threaded straight through from the
 * row itself (review round 2) so a cancelled original and its reversal are
 * distinguishable, not pixel-identical duplicates.
 */
function buildInvestmentTransactionEntries(
  raw: MoneyHistoryRawData,
  movementsByDestinationTxId: ReadonlyMap<string, MoneyMovement>,
): MoneyHistoryEntry[] {
  return raw.investmentTransactions.map((row) => {
    const movement = movementsByDestinationTxId.get(row.id);
    return {
      id: row.id,
      type: "money_added" as MoneyHistoryEntryType,
      date: row.transactionDate,
      projectId: row.projectId,
      projectName: resolveProjectName(row.projectId, raw.projectNamesById),
      partyType: row.partyType,
      shareId: row.shareId,
      personName: resolvePersonName(row.partyType, row.shareId, row.projectId, raw),
      amount: row.amount,
      paymentMode: row.paymentMode,
      from: movement ? resolveProjectName(movement.sourceProjectId, raw.projectNamesById) : null,
      to: null,
      notes: row.notes,
      status: row.status,
      reversalOfTransactionId: row.reversalOfTransactionId,
    };
  });
}

/** Builds every `withdrawal_transactions` row's Money History entry -- `"money_withdrawn"`, always, no `from`/`to` (the destination legs below carry those). Every row included regardless of `status`; `status`/`reversalOfTransactionId` threaded through from the row itself, mirroring `buildInvestmentTransactionEntries`'s identical convention (review round 2). */
function buildWithdrawalTransactionEntries(raw: MoneyHistoryRawData): MoneyHistoryEntry[] {
  return raw.withdrawalTransactions.map((row) => ({
    id: row.id,
    type: "money_withdrawn" as MoneyHistoryEntryType,
    date: row.transactionDate,
    projectId: row.projectId,
    projectName: resolveProjectName(row.projectId, raw.projectNamesById),
    partyType: row.partyType,
    shareId: row.shareId,
    personName: resolvePersonName(row.partyType, row.shareId, row.projectId, raw),
    amount: row.amount,
    paymentMode: row.paymentMode,
    from: null,
    to: null,
    notes: row.notes,
    status: row.status,
    reversalOfTransactionId: row.reversalOfTransactionId,
  }));
}

/**
 * Builds every `withdrawal_destination_allocations` leg's Money History
 * entry -- one entry per leg, per this story's I/O matrix (`"project"` ->
 * `"moved_to_project"`, `"person"` -> `"given_to_person"`,
 * `"available_balance"` -> `"added_to_available_balance"`, `"other"` ->
 * `"given_to_person"`-shaped with `to: "Other"`, no 7th type invented).
 * Every leg's own `partyType`/`shareId`/`projectId`(source)/`date`/
 * `paymentMode` come from its PARENT withdrawal transaction (joined via
 * `withdrawalTransactionId` against `withdrawalTransactionsById`, built once
 * by the caller) -- a leg row carries no such fields of its own. A leg whose
 * parent withdrawal can't be found (a data-integrity edge case outside this
 * story's scope) is silently skipped rather than thrown on -- this function
 * stays total.
 *
 * `status` (review round 2) is also the PARENT's own `status`, not a
 * per-leg concept -- `WithdrawalTransactionPort.cancelTransaction`'s own doc
 * comment confirms a cancel never touches `withdrawal_destination_allocations`/
 * `money_movements` rows directly, so there is no separate "leg reversal"
 * row; a leg whose parent was cancelled is itself effectively void (the
 * cascade already reversed its downstream effects -- e.g. a `"project"`
 * leg's destination `investment_transactions` row is cancelled too, an
 * `"available_balance"` leg's credited pool is debited back). `reversalOfTransactionId`
 * is always `null` here for the identical reason -- a leg is never itself a
 * reversal row.
 */
function buildWithdrawalDestinationAllocationEntries(
  raw: MoneyHistoryRawData,
  withdrawalTransactionsById: ReadonlyMap<string, WithdrawalTransaction>,
): MoneyHistoryEntry[] {
  const entries: MoneyHistoryEntry[] = [];
  for (const leg of raw.withdrawalDestinationAllocations) {
    const parent = withdrawalTransactionsById.get(leg.withdrawalTransactionId);
    if (!parent) {
      continue;
    }

    const base = {
      id: leg.id,
      date: parent.transactionDate,
      projectId: parent.projectId,
      projectName: resolveProjectName(parent.projectId, raw.projectNamesById),
      partyType: parent.partyType,
      shareId: parent.shareId,
      personName: resolvePersonName(parent.partyType, parent.shareId, parent.projectId, raw),
      amount: leg.amount,
      paymentMode: parent.paymentMode,
      notes: leg.notes,
      status: parent.status,
      reversalOfTransactionId: null,
    };

    switch (leg.destinationType) {
      case "project":
        entries.push({
          ...base,
          type: "moved_to_project",
          from: null,
          to: leg.destinationProjectId
            ? resolveProjectName(leg.destinationProjectId, raw.projectNamesById)
            : UNKNOWN_PROJECT_NAME,
        });
        break;
      case "person":
        entries.push({
          ...base,
          type: "given_to_person",
          from: null,
          to: leg.personName ?? "Someone",
        });
        break;
      case "available_balance":
        entries.push({
          ...base,
          type: "added_to_available_balance",
          from: null,
          to: "Available Balance",
        });
        break;
      case "other":
        entries.push({
          ...base,
          type: "given_to_person",
          from: null,
          to: "Other",
        });
        break;
    }
  }
  return entries;
}

/**
 * Builds every `available_balance_spends` row's Money History entry --
 * `"used_from_available_balance"`, always, `from: "Available Balance"`
 * (this row's `sourceProjectId`/`partyType`/`shareId` identify exactly
 * whose balance was debited -- no join needed, unlike a
 * destination-allocation leg). `date` is derived from `createdAt`'s own
 * ISO-date prefix (`available_balance_spends` has no separate
 * `transactionDate` column -- a spend is always recorded "now").
 *
 * `status` is always `"active"`/`reversalOfTransactionId` always `null`
 * (review round 2) -- `available_balance_spends` has no cancel capability
 * built anywhere in this codebase yet, so there is nothing to mark. The
 * deeper, separate gap this leaves (a cancelled `"available_balance"` leg
 * debits the `available_balances` pool back in place, with zero append-only
 * trail Money History could read to show that reversal) is a logged,
 * out-of-scope follow-up, not fixed here.
 */
function buildAvailableBalanceSpendEntries(raw: MoneyHistoryRawData): MoneyHistoryEntry[] {
  return raw.availableBalanceSpends.map((spend) => ({
    id: spend.id,
    type: "used_from_available_balance" as MoneyHistoryEntryType,
    date: spend.createdAt.slice(0, 10),
    projectId: spend.sourceProjectId,
    projectName: resolveProjectName(spend.sourceProjectId, raw.projectNamesById),
    partyType: spend.partyType,
    shareId: spend.shareId,
    personName: resolvePersonName(spend.partyType, spend.shareId, spend.sourceProjectId, raw),
    amount: spend.amount,
    paymentMode: null,
    from: "Available Balance",
    to:
      spend.destinationType === "project"
        ? spend.destinationProjectId
          ? resolveProjectName(spend.destinationProjectId, raw.projectNamesById)
          : UNKNOWN_PROJECT_NAME
        : (spend.personName ?? "Someone"),
    notes: spend.notes,
    status: "active",
    reversalOfTransactionId: null,
  }));
}

/**
 * Builds every `adjustment_nettings` row's Money History entry (Story 5.3,
 * FR33/FR34, AD-4) -- `"adjustment"`, always, `from`/`to`: always `null`
 * (nothing moved -- this is a pure audit record of a business decision, not
 * a money movement, spec-5-3's Decisions #1/#4), `notes` carries the
 * netting's own notes, `personName`/`partyType`/`shareId`/`projectId`
 * resolved from the netting row directly (mirrors every other
 * `build*Entries` function's identical `resolvePersonName`/
 * `resolveProjectName` convention). `paymentMode` is always `null` -- a
 * netting has no payment mode concept. `date` is derived from `createdAt`'s
 * own ISO-date prefix, mirroring `buildAvailableBalanceSpendEntries`'
 * identical "no separate `transactionDate` column" precedent -- a netting is
 * always recorded "now". `status` is always `"active"`/`reversalOfTransactionId`
 * always `null` -- `adjustment_nettings` has no cancel/reverse capability
 * built anywhere in this codebase (this story's Boundaries never call for
 * one: the record's whole point is being a permanent, immutable fact).
 */
function buildAdjustmentNettingEntries(raw: MoneyHistoryRawData): MoneyHistoryEntry[] {
  return (raw.adjustmentNettings ?? []).map((netting) => ({
    id: netting.id,
    type: "adjustment" as MoneyHistoryEntryType,
    date: netting.createdAt.slice(0, 10),
    projectId: netting.projectId,
    projectName: resolveProjectName(netting.projectId, raw.projectNamesById),
    partyType: netting.partyType,
    shareId: netting.shareId,
    personName: resolvePersonName(netting.partyType, netting.shareId, netting.projectId, raw),
    amount: netting.amount,
    paymentMode: null,
    from: null,
    to: null,
    notes: netting.notes,
    status: "active" as const,
    reversalOfTransactionId: null,
  }));
}

/** `true` if `entry` is inside `scope` -- always `true` when unrestricted, otherwise checked against `scope.shareKeys` via the identical key shape `resolveMoneyHistoryScope` builds. */
function isEntryInScope(entry: MoneyHistoryEntry, scope: MoneyHistoryScope): boolean {
  if (scope.unrestricted) {
    return true;
  }
  return scope.shareKeys.has(moneyHistoryShareKey(entry.partyType, entry.shareId, entry.projectId));
}

/** `true` if `entry` matches every filter supplied in `filters` (AND, not OR -- this story's I/O matrix). An unset filter field always matches. */
function matchesFilters(entry: MoneyHistoryEntry, filters: MoneyHistoryFilters): boolean {
  if (filters.dateFrom && entry.date < filters.dateFrom) {
    return false;
  }
  if (filters.dateTo && entry.date > filters.dateTo) {
    return false;
  }
  if (filters.projectId && entry.projectId !== filters.projectId) {
    return false;
  }
  if (filters.partyType && entry.partyType !== filters.partyType) {
    return false;
  }
  if (filters.shareId && entry.shareId !== filters.shareId) {
    return false;
  }
  if (filters.personName) {
    const needle = filters.personName.trim().toLowerCase();
    if (needle && !(entry.personName?.toLowerCase().includes(needle) ?? false)) {
      return false;
    }
  }
  return true;
}

/**
 * Assembles the unified, plain-language Money History list (Story 5.1,
 * FR31) -- pure (AD-9), no DB access: every row this function reads is
 * already fetched, bundled in `raw`. Builds one entry per source row across
 * all 6 tables (via `buildInvestmentTransactionEntries`/
 * `buildWithdrawalTransactionEntries`/`buildWithdrawalDestinationAllocationEntries`/
 * `buildAvailableBalanceSpendEntries`), applies `scope` (drops any entry
 * outside the actor's own scope, when not unrestricted), then `filters`
 * (AND, not OR), then sorts by `date` descending -- ties broken by `id`
 * descending (every id is a uuidv7, itself time-ordered, mirroring
 * `partner-share.ts`'s `isNewerVersion` tie-break convention).
 */
export function assembleMoneyHistory(
  raw: MoneyHistoryRawData,
  scope: MoneyHistoryScope,
  filters: MoneyHistoryFilters,
): MoneyHistoryEntry[] {
  const movementsByDestinationTxId = new Map<string, MoneyMovement>();
  for (const movement of raw.moneyMovements) {
    movementsByDestinationTxId.set(movement.destinationInvestmentTransactionId, movement);
  }

  const withdrawalTransactionsById = new Map<string, WithdrawalTransaction>();
  for (const withdrawal of raw.withdrawalTransactions) {
    withdrawalTransactionsById.set(withdrawal.id, withdrawal);
  }

  const allEntries: MoneyHistoryEntry[] = [
    ...buildInvestmentTransactionEntries(raw, movementsByDestinationTxId),
    ...buildWithdrawalTransactionEntries(raw),
    ...buildWithdrawalDestinationAllocationEntries(raw, withdrawalTransactionsById),
    ...buildAvailableBalanceSpendEntries(raw),
    ...buildAdjustmentNettingEntries(raw),
  ];

  return allEntries
    .filter((entry) => isEntryInScope(entry, scope) && matchesFilters(entry, filters))
    .sort((a, b) => {
      if (a.date !== b.date) {
        return a.date < b.date ? 1 : -1;
      }
      return a.id < b.id ? 1 : -1;
    });
}
