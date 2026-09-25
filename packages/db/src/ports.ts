import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import {
  AlreadyCancelledError,
  IdempotencyKeyConflictError,
  moneyEquals,
  subtractMoney,
  WithdrawalIdempotencyKeyConflictError,
  WithdrawalAlreadyCancelledError,
  WithdrawalAmountLockedByAllocationError,
  assertWithdrawalNotCancelled,
  assertAmountEditable,
  cancelWithdrawalBundle,
  AlreadyAllocatedError,
  WithdrawalDestinationAllocationIdempotencyKeyConflictError,
  moveWithdrawalToProject,
  spendAvailableBalanceToProject,
  assertSufficientBalance,
  InsufficientAvailableBalanceError,
  AvailableBalanceSpendIdempotencyKeyConflictError,
  type UserPort,
  type SessionPort,
  type CreateSessionInput,
  type ProjectPort,
  type PartnerSharePort,
  type SubPartnerSharePort,
  type InvestmentRequirementPort,
  type InvestmentTransactionPort,
  type CreateInvestmentTransactionInput,
  type EditInvestmentTransactionInput,
  type CancelInvestmentTransactionInput,
  type InvestmentAdjustmentPort,
  type RecommendedAmountPort,
  type WithdrawalTransactionPort,
  type CreateWithdrawalTransactionInput,
  type EditWithdrawalTransactionInput,
  type CancelWithdrawalTransactionInput,
  type WithdrawalAdjustmentPort,
  type WithdrawalDestinationAllocationPort,
  type CreateWithdrawalDestinationAllocationLegInput,
  type MoneyMovementPort,
  type AvailableBalancePort,
  type AvailableBalanceSpendPort,
  type RecordAvailableBalanceSpendInput,
  AdjustmentNettingIdempotencyKeyConflictError,
  type AdjustmentNettingPort,
  type RecordAdjustmentNettingInput,
} from "@niveshbook/core";
import type {
  User,
  Session,
  UserRole,
  Project,
  PartnerShare,
  SubPartnerShare,
  Percent,
  InvestmentRequirement,
  InvestmentTransaction,
  InvestmentAdjustment,
  RecommendedAmount,
  WithdrawalTransaction,
  WithdrawalAdjustment,
  WithdrawalDestinationAllocation,
  MoneyMovement,
  DestinationType,
  PaymentMode,
  Money,
  AuditLogEntry,
  AvailableBalance,
  AvailableBalanceSpend,
  AdjustmentNetting,
} from "@niveshbook/types";
import type { Database } from "./client";
import { getDb } from "./client";
import {
  users,
  sessions,
  projects,
  partnerShares,
  subpartnerShares,
  investmentRequirements,
  investmentTransactions,
  investmentAdjustments,
  recommendedAmounts,
  withdrawalTransactions,
  withdrawalAdjustments,
  withdrawalDestinationAllocations,
  moneyMovements,
  availableBalances,
  availableBalanceSpends,
  adjustmentNettings,
  auditLog,
  type SessionRow,
  type UserRow,
  type ProjectRow,
  type PartnerShareRow,
  type SubPartnerShareRow,
  type InvestmentRequirementRow,
  type InvestmentTransactionRow,
  type InvestmentAdjustmentRow,
  type RecommendedAmountRow,
  type WithdrawalTransactionRow,
  type WithdrawalAdjustmentRow,
  type WithdrawalDestinationAllocationRow,
  type MoneyMovementRow,
  type AvailableBalanceRow,
  type AvailableBalanceSpendRow,
  type AdjustmentNettingRow,
  type AuditLogRow,
} from "./schema";

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role as UserRole,
    active: row.active,
    canApproveExtraWithdrawal: row.canApproveExtraWithdrawal,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Converts the numeric `share_percent` column (Drizzle returns `numeric` as
 * a `string`, never a native float -- AD-2) directly into a `Percent`,
 * with no `parseFloat`/`Number()` round-trip.
 */
function toPartnerShare(row: PartnerShareRow): PartnerShare {
  return {
    id: row.id,
    partnerId: row.partnerId,
    projectId: row.projectId,
    name: row.name,
    sharePercent: row.sharePercent as Percent,
    userId: row.userId,
    subPartnerVisibilityGrant: row.subPartnerVisibilityGrant,
    effectiveFrom: row.effectiveFrom.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Converts the numeric `share_percent` column (Drizzle returns `numeric` as
 * a `string`, never a native float -- AD-2) directly into a `Percent`, with
 * no `parseFloat`/`Number()` round-trip. Mirrors `toPartnerShare` one level
 * down.
 */
/**
 * Converts the numeric `amount` column (Drizzle returns `numeric` as a
 * `string`, never a native float -- AD-2) directly into a `Money`, with no
 * `parseFloat`/`Number()` round-trip. `requirementDate` is already a plain
 * `YYYY-MM-DD` string -- the `date` column's default Drizzle mode.
 */
function toInvestmentRequirement(row: InvestmentRequirementRow): InvestmentRequirement {
  return {
    id: row.id,
    projectId: row.projectId,
    amount: row.amount as Money,
    requirementDate: row.requirementDate,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Converts the numeric `share_percent_snapshot`/`should_pay_snapshot`/
 * `amount` columns (Drizzle returns `numeric` as a `string`, never a native
 * float -- AD-2) directly into `Percent`/`Money`, with no `parseFloat`/
 * `Number()` round-trip. `transactionDate` is already a plain `YYYY-MM-DD`
 * string -- the `date` column's default Drizzle mode, mirroring
 * `toInvestmentRequirement`.
 */
function toInvestmentTransaction(row: InvestmentTransactionRow): InvestmentTransaction {
  return {
    id: row.id,
    requirementId: row.requirementId,
    projectId: row.projectId,
    partyType: row.partyType as InvestmentTransaction["partyType"],
    shareId: row.shareId,
    sharePercentSnapshot: row.sharePercentSnapshot as Percent,
    shouldPaySnapshot: row.shouldPaySnapshot as Money,
    amount: row.amount as Money,
    transactionDate: row.transactionDate,
    paymentMode: row.paymentMode as PaymentMode,
    referenceNumber: row.referenceNumber,
    notes: row.notes,
    status: row.status as InvestmentTransaction["status"],
    reversalOfTransactionId: row.reversalOfTransactionId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Converts the numeric `should_pay`/`actual_paid`/`adjustment_amount`
 * columns (Drizzle returns `numeric` as a `string`, never a native float --
 * AD-2) directly into `Money`, with no `parseFloat`/`Number()` round-trip.
 * Mirrors `toInvestmentTransaction` one table over.
 */
function toInvestmentAdjustment(row: InvestmentAdjustmentRow): InvestmentAdjustment {
  return {
    id: row.id,
    projectId: row.projectId,
    partyType: row.partyType as InvestmentAdjustment["partyType"],
    shareId: row.shareId,
    requirementId: row.requirementId,
    shouldPay: row.shouldPay as Money,
    actualPaid: row.actualPaid as Money,
    adjustmentType: row.adjustmentType as InvestmentAdjustment["adjustmentType"],
    adjustmentAmount: row.adjustmentAmount as Money,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Converts the numeric `base_amount`/`previous_pending`/`previous_extra_paid`/
 * `recommended_amount` columns (Drizzle returns `numeric` as a `string`,
 * never a native float -- AD-2) directly into `Money`, with no `parseFloat`/
 * `Number()` round-trip. Mirrors `toInvestmentAdjustment` one table over.
 */
function toRecommendedAmount(row: RecommendedAmountRow): RecommendedAmount {
  return {
    id: row.id,
    requirementId: row.requirementId,
    projectId: row.projectId,
    partyType: row.partyType as RecommendedAmount["partyType"],
    shareId: row.shareId,
    baseAmount: row.baseAmount as Money,
    previousPending: row.previousPending as Money,
    previousExtraPaid: row.previousExtraPaid as Money,
    recommendedAmount: row.recommendedAmount as Money,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Converts a generic `audit_log` row (Story 3.3, `idempotencyKey` column
 * added Story 3.7) into the entity-agnostic `AuditLogEntry` read type --
 * `oldValue`/`newValue` pass through unchanged (already plain JSON, as
 * stored by `jsonb`), never re-typed to any specific entity's shape (this
 * table is reused across every entity Epic 3/4 eventually audits, AD-5).
 */
function toAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    actorUserId: row.actorUserId,
    oldValue: row.oldValue,
    newValue: row.newValue,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Converts the numeric `share_percent_snapshot`/`can_take_snapshot`/
 * `amount` columns (Drizzle returns `numeric` as a `string`, never a native
 * float -- AD-2) directly into `Percent`/`Money`, with no `parseFloat`/
 * `Number()` round-trip. `transactionDate` is already a plain `YYYY-MM-DD`
 * string -- the `date` column's default Drizzle mode. Mirrors
 * `toInvestmentTransaction` one ledger over.
 */
function toWithdrawalTransaction(row: WithdrawalTransactionRow): WithdrawalTransaction {
  return {
    id: row.id,
    projectId: row.projectId,
    partyType: row.partyType as WithdrawalTransaction["partyType"],
    shareId: row.shareId,
    sharePercentSnapshot: row.sharePercentSnapshot as Percent,
    canTakeSnapshot: row.canTakeSnapshot as Money,
    amount: row.amount as Money,
    transactionDate: row.transactionDate,
    paymentMode: row.paymentMode as PaymentMode,
    referenceNumber: row.referenceNumber,
    notes: row.notes,
    status: row.status as WithdrawalTransaction["status"],
    reversalOfTransactionId: row.reversalOfTransactionId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toWithdrawalAdjustment(row: WithdrawalAdjustmentRow): WithdrawalAdjustment {
  return {
    id: row.id,
    projectId: row.projectId,
    partyType: row.partyType as WithdrawalAdjustment["partyType"],
    shareId: row.shareId,
    canTake: row.canTake as Money,
    taken: row.taken as Money,
    adjustmentType: row.adjustmentType as WithdrawalAdjustment["adjustmentType"],
    adjustmentAmount: row.adjustmentAmount as Money,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toWithdrawalDestinationAllocation(
  row: WithdrawalDestinationAllocationRow,
): WithdrawalDestinationAllocation {
  return {
    id: row.id,
    withdrawalTransactionId: row.withdrawalTransactionId,
    destinationType: row.destinationType as DestinationType,
    amount: row.amount as Money,
    destinationProjectId: row.destinationProjectId,
    personName: row.personName,
    notes: row.notes,
    destinationRequirementId: row.destinationRequirementId,
    destinationShareId: row.destinationShareId,
    destinationPartyType: row.destinationPartyType as WithdrawalDestinationAllocation["destinationPartyType"],
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Converts the numeric `amount` column (Drizzle returns `numeric` as a
 * `string`, never a native float -- AD-2) directly into a `Money`, with no
 * `parseFloat`/`Number()` round-trip. Mirrors `toWithdrawalDestinationAllocation`
 * one table over (Story 4.8).
 */
function toMoneyMovement(row: MoneyMovementRow): MoneyMovement {
  return {
    id: row.id,
    withdrawalDestinationAllocationId: row.withdrawalDestinationAllocationId,
    availableBalanceSpendId: row.availableBalanceSpendId,
    sourceProjectId: row.sourceProjectId,
    destinationProjectId: row.destinationProjectId,
    destinationInvestmentTransactionId: row.destinationInvestmentTransactionId,
    amount: row.amount as Money,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Converts an `available_balances` row -- mirrors `toWithdrawalAdjustment`'s identical shape one ledger over. */
function toAvailableBalance(row: AvailableBalanceRow): AvailableBalance {
  return {
    id: row.id,
    projectId: row.projectId,
    partyType: row.partyType as AvailableBalance["partyType"],
    shareId: row.shareId,
    balance: row.balance as Money,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Converts an `available_balance_spends` row -- mirrors `toWithdrawalDestinationAllocation`'s identical shape one ledger over. */
function toAvailableBalanceSpend(row: AvailableBalanceSpendRow): AvailableBalanceSpend {
  return {
    id: row.id,
    sourceProjectId: row.sourceProjectId,
    partyType: row.partyType as AvailableBalanceSpend["partyType"],
    shareId: row.shareId,
    destinationType: row.destinationType as AvailableBalanceSpend["destinationType"],
    destinationProjectId: row.destinationProjectId,
    destinationRequirementId: row.destinationRequirementId,
    destinationShareId: row.destinationShareId,
    destinationPartyType: row.destinationPartyType as AvailableBalanceSpend["destinationPartyType"],
    personName: row.personName,
    amount: row.amount as Money,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Converts an `adjustment_nettings` row -- mirrors `toAvailableBalanceSpend`'s identical shape one table over (Story 5.3). */
function toAdjustmentNetting(row: AdjustmentNettingRow): AdjustmentNetting {
  return {
    id: row.id,
    projectId: row.projectId,
    partyType: row.partyType as AdjustmentNetting["partyType"],
    shareId: row.shareId,
    investmentRequirementId: row.investmentRequirementId,
    amount: row.amount as Money,
    notes: row.notes,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSubPartnerShare(row: SubPartnerShareRow): SubPartnerShare {
  return {
    id: row.id,
    subPartnerId: row.subPartnerId,
    partnerId: row.partnerId,
    projectId: row.projectId,
    name: row.name,
    sharePercent: row.sharePercent as Percent,
    userId: row.userId,
    effectiveFrom: row.effectiveFrom.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Drizzle-backed implementation of `packages/core`'s `UserPort`. */
export function createUserPort(database: Database = getDb()): UserPort {
  return {
    async findUserByEmail(email) {
      const normalizedEmail = email.trim().toLowerCase();
      const rows = await database
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      const row = rows[0];
      return row ? toUser(row) : null;
    },
    async findUserById(id) {
      const rows = await database.select().from(users).where(eq(users.id, id)).limit(1);
      const row = rows[0];
      return row ? toUser(row) : null;
    },
    async listAllUsers() {
      const rows = await database.select().from(users);
      return rows.map(toUser);
    },
    async setUserActive(id, active) {
      const [row] = await database
        .update(users)
        .set({ active })
        .where(eq(users.id, id))
        .returning();
      return row ? toUser(row) : null;
    },
    async setApprovalAuthority(id, granted) {
      const [row] = await database
        .update(users)
        .set({ canApproveExtraWithdrawal: granted })
        .where(eq(users.id, id))
        .returning();
      return row ? toUser(row) : null;
    },
  };
}

/** Drizzle-backed implementation of `packages/core`'s `SessionPort` (AD-8). */
export function createSessionPort(database: Database = getDb()): SessionPort {
  return {
    async createSession(input: CreateSessionInput) {
      const [row] = await database
        .insert(sessions)
        .values({
          id: uuidv7(),
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: new Date(input.expiresAt),
        })
        .returning();
      if (!row) {
        throw new Error("Failed to create session");
      }
      return toSession(row);
    },
    async deleteSession(tokenHash) {
      await database.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },
    async findSessionByTokenHash(tokenHash) {
      const rows = await database
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      return row ? toSession(row) : null;
    },
    async touchSession(tokenHash, expiresAt) {
      const updatedRows = await database
        .update(sessions)
        .set({ expiresAt: new Date(expiresAt) })
        .where(eq(sessions.tokenHash, tokenHash))
        .returning({ id: sessions.id });
      return updatedRows.length;
    },
    async listSessionsByUser(userId) {
      const rows = await database
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
      return rows.map(toSession);
    },
    async deleteSessionById(id, userId) {
      const deletedRows = await database
        .delete(sessions)
        .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
        .returning({ id: sessions.id });
      return deletedRows.length;
    },
    async deleteAllSessionsForUser(userId) {
      const deletedRows = await database
        .delete(sessions)
        .where(eq(sessions.userId, userId))
        .returning({ id: sessions.id });
      return deletedRows.length;
    },
  };
}

/** Drizzle-backed implementation of `packages/core`'s `ProjectPort` (Story 2.1). */
export function createProjectPort(database: Database = getDb()): ProjectPort {
  return {
    async createProject(input) {
      const [row] = await database
        .insert(projects)
        .values({
          id: uuidv7(),
          name: input.name,
          description: input.description,
        })
        .returning();
      if (!row) {
        throw new Error("Failed to create project");
      }
      return toProject(row);
    },
    async updateProject(id, input) {
      const [row] = await database
        .update(projects)
        .set({ name: input.name, description: input.description, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning();
      return row ? toProject(row) : null;
    },
    async findProjectById(id) {
      const rows = await database.select().from(projects).where(eq(projects.id, id)).limit(1);
      const row = rows[0];
      return row ? toProject(row) : null;
    },
    async listProjects() {
      const rows = await database.select().from(projects);
      return rows.map(toProject);
    },
  };
}

/**
 * Drizzle-backed implementation of `packages/core`'s `PartnerSharePort`
 * (Story 2.2). Every `createPartnerShare` call inserts a brand-new row --
 * there is no update path here at all, since AD-3 means `sharePercent` is
 * immutable once set (the domain layer's `updatePartnerShare` calls this
 * same method with the existing `partnerId` to create the next version).
 */
export function createPartnerSharePort(database: Database = getDb()): PartnerSharePort {
  return {
    async createPartnerShare(input) {
      const [row] = await database
        .insert(partnerShares)
        .values({
          id: uuidv7(),
          partnerId: input.partnerId,
          projectId: input.projectId,
          name: input.name,
          sharePercent: input.sharePercent,
          userId: input.userId,
          subPartnerVisibilityGrant: input.subPartnerVisibilityGrant,
        })
        .returning();
      if (!row) {
        throw new Error("Failed to create partner share");
      }
      return toPartnerShare(row);
    },
    async findLatestByPartnerId(partnerId) {
      const rows = await database
        .select()
        .from(partnerShares)
        .where(eq(partnerShares.partnerId, partnerId))
        .orderBy(desc(partnerShares.effectiveFrom), desc(partnerShares.id))
        .limit(1);
      const row = rows[0];
      return row ? toPartnerShare(row) : null;
    },
    async listByProjectId(projectId) {
      const rows = await database
        .select()
        .from(partnerShares)
        .where(eq(partnerShares.projectId, projectId));
      return rows.map(toPartnerShare);
    },
    async listAll() {
      const rows = await database.select().from(partnerShares);
      return rows.map(toPartnerShare);
    },
  };
}

/**
 * Drizzle-backed implementation of `packages/core`'s `SubPartnerSharePort`
 * (Story 2.3). Every `createSubPartnerShare` call inserts a brand-new row --
 * there is no update path here at all, since AD-3 means `sharePercent` is
 * immutable once set (the domain layer's `updateSubPartnerShare` calls this
 * same method with the existing `subPartnerId` to create the next
 * version). Mirrors `createPartnerSharePort` one level down.
 */
export function createSubPartnerSharePort(database: Database = getDb()): SubPartnerSharePort {
  return {
    async createSubPartnerShare(input) {
      const [row] = await database
        .insert(subpartnerShares)
        .values({
          id: uuidv7(),
          subPartnerId: input.subPartnerId,
          partnerId: input.partnerId,
          projectId: input.projectId,
          name: input.name,
          sharePercent: input.sharePercent,
          userId: input.userId,
        })
        .returning();
      if (!row) {
        throw new Error("Failed to create sub-partner share");
      }
      return toSubPartnerShare(row);
    },
    async findLatestBySubPartnerId(subPartnerId) {
      const rows = await database
        .select()
        .from(subpartnerShares)
        .where(eq(subpartnerShares.subPartnerId, subPartnerId))
        .orderBy(desc(subpartnerShares.effectiveFrom), desc(subpartnerShares.id))
        .limit(1);
      const row = rows[0];
      return row ? toSubPartnerShare(row) : null;
    },
    async listByPartnerId(partnerId) {
      const rows = await database
        .select()
        .from(subpartnerShares)
        .where(eq(subpartnerShares.partnerId, partnerId));
      return rows.map(toSubPartnerShare);
    },
    async listByProjectId(projectId) {
      const rows = await database
        .select()
        .from(subpartnerShares)
        .where(eq(subpartnerShares.projectId, projectId));
      return rows.map(toSubPartnerShare);
    },
    async listAll() {
      const rows = await database.select().from(subpartnerShares);
      return rows.map(toSubPartnerShare);
    },
  };
}

/**
 * Drizzle-backed implementation of `packages/core`'s `InvestmentRequirementPort`
 * (Story 3.1). Unlike `createPartnerSharePort`, there is no `findLatest*`
 * method -- a funding requirement is never versioned, so every row is
 * already "current".
 */
export function createInvestmentRequirementPort(
  database: Database = getDb(),
): InvestmentRequirementPort {
  return {
    async createInvestmentRequirement(input) {
      const [row] = await database
        .insert(investmentRequirements)
        .values({
          id: uuidv7(),
          projectId: input.projectId,
          amount: input.amount,
          requirementDate: input.requirementDate,
        })
        .returning();
      if (!row) {
        throw new Error("Failed to create investment requirement");
      }
      return toInvestmentRequirement(row);
    },
    async listByProjectId(projectId) {
      const rows = await database
        .select()
        .from(investmentRequirements)
        .where(eq(investmentRequirements.projectId, projectId))
        // Most recent funding round first -- the Add Money screen's whole
        // purpose is showing funding rounds over time, so DB order (which
        // has no guaranteed meaning) isn't acceptable here, unlike a
        // not-yet-consumed list. `createdAt` breaks ties between rows that
        // happen to share the same `requirementDate`.
        .orderBy(desc(investmentRequirements.requirementDate), desc(investmentRequirements.createdAt));
      return rows.map(toInvestmentRequirement);
    },
    async findById(id) {
      const rows = await database
        .select()
        .from(investmentRequirements)
        .where(eq(investmentRequirements.id, id))
        .limit(1);
      const row = rows[0];
      return row ? toInvestmentRequirement(row) : null;
    },
  };
}

/** Postgres's unique-violation SQL state (`23505`) -- the `postgres` driver surfaces it as `.code` on the thrown error. */
const UNIQUE_VIOLATION_CODE = "23505";

/**
 * `true` if `error` is a Postgres unique-constraint-violation error (SQL
 * state `23505`). Checks `error.code` directly (the `postgres` driver's own
 * raw `PostgresError` shape) AND `error.cause?.code` (this drizzle-orm
 * version's `DrizzleQueryError` wrapper around that same raw driver error,
 * confirmed via live-Postgres debugging during Story 4.9's own concurrent-
 * race test development -- every one of this codebase's existing concurrent-
 * double-submit-recovery call sites, e.g.
 * `createWithdrawalTransactionPort.recordTransaction`, silently relied on
 * this exact same latent bug: `database.transaction(async (tx) => {...})`'s
 * thrown error is a `DrizzleQueryError`, not the raw `PostgresError`, so the
 * old `"code" in error` check never actually matched it -- their own
 * concurrent-race tests were already intermittently flaky for the identical
 * reason, just not run enough times in a row for it to surface before now).
 * A pure decision helper with no DB/Drizzle dependency of its own -- exported
 * so `ports.test.ts` can unit-test it directly against a variety of error
 * shapes, without needing a live Postgres connection or a
 * Drizzle-transaction-mocking harness (this codebase has no precedent for
 * mocking Drizzle at that level).
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === UNIQUE_VIOLATION_CODE) {
    return true;
  }
  const cause = candidate.cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { code?: unknown }).code === UNIQUE_VIOLATION_CODE
  );
}

/**
 * `true` if `existing` (a row found by `idempotencyKey`) actually represents
 * the *same* logical request as `input` -- compared on `requirementId`/
 * `shareId`/`partyType`/`amount`, the fields that identify what was being
 * recorded (not `sharePercentSnapshot`/`shouldPaySnapshot`, which are
 * server-computed outputs, not caller-supplied request identity). Since
 * `idempotency_key` is a table-wide UNIQUE column with no other scoping, a
 * bare key match alone isn't sufficient proof this is a legitimate replay --
 * see `IdempotencyKeyConflictError`'s own doc comment.
 *
 * `amount` is compared via `moneyEquals` (decimal-value-aware), never `===`
 * -- `existing.amount` came back from Postgres's `numeric(14,2)` column,
 * which round-trips a stored value at its full declared scale (a submitted
 * `"700000"` reads back as `"700000.00"` -- exact, no precision lost, just
 * padded), while `input.amount` is the freshly-submitted, unreformatted
 * value. A raw `===` here would reject a byte-identical resubmission's own
 * legitimate replay as a false "conflict" (`toMoney` itself deliberately
 * never reformats the value it's given, so the two representations never
 * converge on their own). `requirementId`/`shareId`/`partyType` have no such
 * round-trip concern (UUIDs/enum values) and stay exact string comparisons.
 * Exported so `ports.test.ts` can unit-test it directly, mirroring
 * `isUniqueViolation`'s precedent.
 */
export function matchesRequest(
  existing: InvestmentTransaction,
  input: Pick<CreateInvestmentTransactionInput, "requirementId" | "shareId" | "partyType" | "amount">,
): boolean {
  return (
    existing.requirementId === input.requirementId &&
    existing.shareId === input.shareId &&
    existing.partyType === input.partyType &&
    moneyEquals(existing.amount, input.amount)
  );
}

/**
 * `true` if `entry` (an `audit_log` row found by `idempotencyKey`) actually
 * represents the *same* logical edit request as `input` -- the
 * `editTransaction` analog of `matchesRequest` one level over. Since
 * `audit_log.idempotencyKey` is a table-wide UNIQUE-when-present column with
 * no other scoping, a bare key match alone isn't sufficient proof this is a
 * legitimate replay of *this* edit rather than a genuine collision with some
 * other edit request: `entry.entityId` must match `input.transactionId`
 * (the same transaction being edited), and `entry.newValue` (the full
 * resulting row, stored as JSON) must match every field `input` is asking to
 * change.
 *
 * `amount` is compared via `moneyEquals` (decimal-value-aware), never
 * `===`, mirroring `matchesRequest`'s identical rationale --
 * `entry.newValue.amount` came back from Postgres's `numeric(14,2)` column
 * by way of `jsonb` (still a string, still round-tripped to the column's
 * full declared scale), while `input.amount` is the freshly-submitted,
 * unreformatted value.
 */
export function matchesEditRequest(
  entry: Pick<AuditLogRow, "entityId" | "newValue">,
  input: Pick<
    EditInvestmentTransactionInput,
    "transactionId" | "amount" | "transactionDate" | "paymentMode" | "referenceNumber" | "notes"
  >,
): boolean {
  if (entry.entityId !== input.transactionId) {
    return false;
  }
  if (typeof entry.newValue !== "object" || entry.newValue === null) {
    return false;
  }
  const newValue = entry.newValue as {
    amount?: unknown;
    transactionDate?: unknown;
    paymentMode?: unknown;
    referenceNumber?: unknown;
    notes?: unknown;
  };
  if (typeof newValue.amount !== "string") {
    return false;
  }
  return (
    moneyEquals(newValue.amount as Money, input.amount) &&
    newValue.transactionDate === input.transactionDate &&
    newValue.paymentMode === input.paymentMode &&
    (newValue.referenceNumber ?? null) === input.referenceNumber &&
    (newValue.notes ?? null) === input.notes
  );
}

/**
 * `true` if `entry` (an `audit_log` row found by `idempotencyKey`) actually
 * represents the *same* logical cancel request as `input` -- the
 * `cancelTransaction` (Story 3.8) analog of `matchesEditRequest` one level
 * over. Unlike an edit's request body, a cancel request carries no other
 * caller-supplied content to compare (amount/date/paymentMode/etc. never
 * change) -- `entry.entityId` matching `input.transactionId` (the same
 * transaction being cancelled) is the entire check: a mismatch means a
 * genuine key collision with some unrelated edit/cancel request, never a
 * legitimate replay of *this* cancel.
 */
export function matchesCancelRequest(
  entry: Pick<AuditLogRow, "entityId">,
  input: Pick<CancelInvestmentTransactionInput, "transactionId">,
): boolean {
  return entry.entityId === input.transactionId;
}

/**
 * `true` if `existing` (a `withdrawal_transactions` row found by
 * `idempotencyKey`) actually represents the *same* logical request as
 * `input` -- compared on `projectId`/`shareId`/`partyType`/`amount`, mirroring
 * `matchesRequest`'s exact rationale one ledger over (`sharePercentSnapshot`/
 * `canTakeSnapshot` are server-computed outputs, not caller-supplied request
 * identity, so they're deliberately excluded from this comparison, same as
 * `matchesRequest` excludes `sharePercentSnapshot`/`shouldPaySnapshot`).
 *
 * `amount` is compared via `moneyEquals` (decimal-value-aware), never `===`
 * -- `existing.amount` came back from Postgres's `numeric(14,2)` column,
 * which round-trips a stored value at its full declared scale, while
 * `input.amount` is the freshly-submitted, unreformatted value -- mirrors
 * `matchesRequest`'s identical rounding-safety rationale (this story's
 * Decisions).
 */
export function matchesWithdrawalRequest(
  existing: WithdrawalTransaction,
  input: Pick<CreateWithdrawalTransactionInput, "projectId" | "shareId" | "partyType" | "amount">,
): boolean {
  return (
    existing.projectId === input.projectId &&
    existing.shareId === input.shareId &&
    existing.partyType === input.partyType &&
    moneyEquals(existing.amount, input.amount)
  );
}

/**
 * `true` if `entry` (an `audit_log` row found by `idempotencyKey`) actually
 * represents the *same* logical edit request as `input` -- Story 4.11's
 * `editTransaction` analog of `matchesEditRequest` one ledger over.
 * `entry.entityId` must match `input.transactionId`, and `entry.newValue`
 * (the full resulting row, stored as JSON) must match every field `input` is
 * asking to change. `amount` is compared via `moneyEquals`, mirroring
 * `matchesEditRequest`'s identical rounding-safety rationale.
 */
export function matchesEditWithdrawalRequest(
  entry: Pick<AuditLogRow, "entityId" | "newValue">,
  input: Pick<
    EditWithdrawalTransactionInput,
    "transactionId" | "amount" | "transactionDate" | "paymentMode" | "referenceNumber" | "notes"
  >,
): boolean {
  if (entry.entityId !== input.transactionId) {
    return false;
  }
  if (typeof entry.newValue !== "object" || entry.newValue === null) {
    return false;
  }
  const newValue = entry.newValue as {
    amount?: unknown;
    transactionDate?: unknown;
    paymentMode?: unknown;
    referenceNumber?: unknown;
    notes?: unknown;
  };
  if (typeof newValue.amount !== "string") {
    return false;
  }
  return (
    moneyEquals(newValue.amount as Money, input.amount) &&
    newValue.transactionDate === input.transactionDate &&
    newValue.paymentMode === input.paymentMode &&
    (newValue.referenceNumber ?? null) === input.referenceNumber &&
    (newValue.notes ?? null) === input.notes
  );
}

/**
 * `true` if `entry` (an `audit_log` row found by `idempotencyKey`) actually
 * represents the *same* logical cancel request as `input` -- Story 4.11's
 * `cancelTransaction` analog of `matchesCancelRequest` one ledger over.
 * Mirrors `matchesCancelRequest`'s identical "entityId match is the entire
 * check" rationale -- a cancel request carries no other caller-supplied
 * content to compare.
 */
export function matchesCancelWithdrawalRequest(
  entry: Pick<AuditLogRow, "entityId">,
  input: Pick<CancelWithdrawalTransactionInput, "transactionId">,
): boolean {
  return entry.entityId === input.transactionId;
}

/**
 * `true` if `existingRows` (every `withdrawal_destination_allocations` row
 * already saved for one withdrawal/idempotencyKey) represents the exact
 * same set of legs as `legs` (the current request) -- Story 4.7's
 * `createWithdrawalDestinationAllocationPort.recordAllocation` analog of
 * `matchesWithdrawalRequest`/`matchesCancelRequest` one story over. Order-
 * independent (multiset match via a mutable `remaining` copy, not a
 * positional `.every`) -- nothing in this story's contract guarantees a
 * replayed request's `legs` array arrives in the exact same order as the
 * original, and Drizzle's `.insert(...).returning()` doesn't guarantee
 * insertion order back either. `amount` is compared via `moneyEquals`
 * (decimal-safe), never `===`, mirroring `matchesWithdrawalRequest`'s
 * identical rounding-safety rationale -- `existingRows[].amount` came back
 * from Postgres's `numeric(14,2)` column. `destinationProjectId`/
 * `personName`/`notes` are compared with `?? null` on both sides so a
 * `undefined` (can't actually occur here, both sides are already `| null`)
 * never spuriously mismatches a stored `null`. Story 4.8 adds
 * `destinationRequirementId`/`destinationShareId`/`destinationPartyType` to
 * this same comparison, mirroring the identical `?? null` rationale -- a
 * replay whose "project" leg now names a *different* requirement/share is a
 * genuine content mismatch, not a legitimate replay of the original request.
 */
export function matchesAllocationRequest(
  existingRows: readonly WithdrawalDestinationAllocationRow[],
  legs: readonly CreateWithdrawalDestinationAllocationLegInput[],
): boolean {
  if (existingRows.length !== legs.length) {
    return false;
  }
  const remaining = [...existingRows];
  for (const leg of legs) {
    const matchIndex = remaining.findIndex(
      (row) =>
        row.destinationType === leg.destinationType &&
        moneyEquals(row.amount as Money, leg.amount) &&
        (row.destinationProjectId ?? null) === (leg.destinationProjectId ?? null) &&
        (row.personName ?? null) === (leg.personName ?? null) &&
        (row.notes ?? null) === (leg.notes ?? null) &&
        (row.destinationRequirementId ?? null) === (leg.destinationRequirementId ?? null) &&
        (row.destinationShareId ?? null) === (leg.destinationShareId ?? null) &&
        (row.destinationPartyType ?? null) === (leg.destinationPartyType ?? null),
    );
    if (matchIndex === -1) {
      return false;
    }
    remaining.splice(matchIndex, 1);
  }
  return true;
}

/**
 * Drizzle-backed implementation of `packages/core`'s `WithdrawalTransactionPort`
 * (Story 4.2) -- mirrors `createInvestmentTransactionPort.recordTransaction`'s
 * exact atomicity/idempotency structure one ledger over, deliberately
 * narrower (no `editTransaction`/`cancelTransaction`/`findById`/
 * `findAuditLogByTransactionId` yet -- Story 4.11's job, mirroring
 * `withdrawal_transactions`' own Story-3.3-before-3.7/3.8 shape).
 *
 * `recordTransaction`'s idempotency handling, in order (identical to
 * `createInvestmentTransactionPort.recordTransaction`'s own doc comment, one
 * ledger over):
 * 1. `SELECT` by `idempotencyKey` first -- if a row already exists AND it
 *    `matchesWithdrawalRequest` the current `input` (same `projectId`/
 *    `shareId`/`partyType`/`amount`), return it immediately (`created:
 *    false`), no transaction attempted at all (the straightforward replay
 *    case). If a row exists but does NOT match, this is a genuine key
 *    collision between two unrelated requests -- throw
 *    `WithdrawalIdempotencyKeyConflictError` rather than silently returning
 *    the mismatched row.
 * 2. Otherwise (no existing row), insert the transaction row and its paired
 *    `audit_log` row together inside one `database.transaction()` call
 *    (`created: true`).
 * 3. If that insert throws because of the `idempotency_key` UNIQUE
 *    constraint (SQL state `23505`) -- a concurrent double-submit that raced
 *    step 1 -- catch it, re-`SELECT` by `idempotencyKey`, and apply the same
 *    `matchesWithdrawalRequest` check to the winning row: match -> return it
 *    (`created: false`) instead of propagating the error; mismatch ->
 *    `WithdrawalIdempotencyKeyConflictError`. Any other error still
 *    propagates unchanged.
 */
export function createWithdrawalTransactionPort(
  database: Database = getDb(),
): WithdrawalTransactionPort {
  async function findByIdempotencyKey(idempotencyKey: string): Promise<WithdrawalTransaction | null> {
    const rows = await database
      .select()
      .from(withdrawalTransactions)
      .where(eq(withdrawalTransactions.idempotencyKey, idempotencyKey))
      .limit(1);
    const row = rows[0];
    return row ? toWithdrawalTransaction(row) : null;
  }

  /** Shared by `findById` and `editTransaction`'s idempotent-replay paths -- mirrors `createInvestmentTransactionPort`'s identical `findTransactionById` helper one ledger over. */
  async function findTransactionById(id: string): Promise<WithdrawalTransaction | null> {
    const rows = await database
      .select()
      .from(withdrawalTransactions)
      .where(eq(withdrawalTransactions.id, id))
      .limit(1);
    const row = rows[0];
    return row ? toWithdrawalTransaction(row) : null;
  }

  /** Shared by `editTransaction`'s/`cancelTransaction`'s straightforward-replay and concurrent-race-recovery paths -- mirrors `createInvestmentTransactionPort`'s identical helper one ledger over. */
  async function findAuditEntryByIdempotencyKey(idempotencyKey: string): Promise<AuditLogRow | null> {
    const rows = await database
      .select()
      .from(auditLog)
      .where(eq(auditLog.idempotencyKey, idempotencyKey))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * The reversal row linked to one original withdrawal (Story 4.11) --
   * mirrors `createInvestmentTransactionPort`'s identical `findReversalRow`
   * helper one ledger over, including its `executor`-accepts-either-`Database`-
   * or-`tx` shape.
   */
  async function findWithdrawalReversalRow(
    executor: Pick<Database, "select">,
    originalTransactionId: string,
  ): Promise<WithdrawalTransactionRow | null> {
    const rows = await executor
      .select()
      .from(withdrawalTransactions)
      .where(eq(withdrawalTransactions.reversalOfTransactionId, originalTransactionId))
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    async recordTransaction(input) {
      const existing = await findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        if (!matchesWithdrawalRequest(existing, input)) {
          throw new WithdrawalIdempotencyKeyConflictError();
        }
        return { transaction: existing, created: false };
      }

      try {
        const inserted = await database.transaction(async (tx) => {
          const [transactionRow] = await tx
            .insert(withdrawalTransactions)
            .values({
              id: uuidv7(),
              projectId: input.projectId,
              partyType: input.partyType,
              shareId: input.shareId,
              sharePercentSnapshot: input.sharePercentSnapshot,
              canTakeSnapshot: input.canTakeSnapshot,
              amount: input.amount,
              transactionDate: input.transactionDate,
              paymentMode: input.paymentMode,
              referenceNumber: input.referenceNumber,
              notes: input.notes,
              idempotencyKey: input.idempotencyKey,
            })
            .returning();
          if (!transactionRow) {
            throw new Error("Failed to record withdrawal transaction");
          }

          await tx.insert(auditLog).values({
            id: uuidv7(),
            entityType: "withdrawal_transaction",
            entityId: transactionRow.id,
            action: "create",
            actorUserId: input.actorUserId,
            oldValue: null,
            newValue: transactionRow,
            reason: null,
          });

          return transactionRow;
        });

        return { transaction: toWithdrawalTransaction(inserted), created: true };
      } catch (error) {
        if (isUniqueViolation(error)) {
          const winner = await findByIdempotencyKey(input.idempotencyKey);
          if (winner) {
            if (!matchesWithdrawalRequest(winner, input)) {
              throw new WithdrawalIdempotencyKeyConflictError();
            }
            return { transaction: winner, created: false };
          }
        }
        throw error;
      }
    },
    async listByProjectId(projectId) {
      const rows = await database
        .select()
        .from(withdrawalTransactions)
        .where(eq(withdrawalTransactions.projectId, projectId))
        .orderBy(asc(withdrawalTransactions.createdAt));
      return rows.map(toWithdrawalTransaction);
    },
    /**
     * Story 4.9 (FR29, Can Take fix): mirrors
     * `createInvestmentTransactionPort.sumActiveAmountByProjectId`'s
     * identical DB-side `SUM(amount)` shape one ledger over -- Postgres does
     * the addition, never application code (AD-2). Deliberately still sums
     * EVERY row unconditionally, cancelled or not, even after Story 4.11
     * added `status` to this table -- extending this method (and the
     * Withdrawal Adjustment/Can Take computation it feeds) to exclude
     * cancelled withdrawals is out of this story's own Code Map/Boundaries
     * (see spec-4-11's Implementation Notes); left as a deliberate, explicit
     * non-goal rather than silently changed. `coalesce(..., 0)` covers the
     * zero-withdrawals case (`SUM` over zero rows is SQL `NULL`).
     */
    async sumActiveAmountByProjectId(projectId) {
      const [row] = await database
        .select({
          total: sql<string>`coalesce(sum(${withdrawalTransactions.amount}), 0)`,
        })
        .from(withdrawalTransactions)
        .where(eq(withdrawalTransactions.projectId, projectId));
      return (row?.total ?? "0") as Money;
    },
    /** Story 4.10 (FR30) -- mirrors `createInvestmentTransactionPort.findById`'s identical plain-select shape one ledger over. */
    async findById(id) {
      return findTransactionById(id);
    },
    /** Story 5.1 (FR31) -- mirrors `createInvestmentTransactionPort.listAll`'s identical shape one ledger over. */
    async listAll() {
      const rows = await database.select().from(withdrawalTransactions);
      return rows.map(toWithdrawalTransaction);
    },
    /**
     * Story 4.11's `editTransaction` -- mirrors
     * `createInvestmentTransactionPort.editTransaction`'s exact atomicity/
     * idempotency/`SELECT ... FOR UPDATE`-concurrency-safety structure one
     * ledger over, plus one more piece that method doesn't need: the
     * amount-locked-by-allocation guard (this story's Decisions #5).
     */
    async editTransaction(input) {
      const existingEntry = await findAuditEntryByIdempotencyKey(input.idempotencyKey);
      if (existingEntry) {
        if (!matchesEditWithdrawalRequest(existingEntry, input)) {
          throw new WithdrawalIdempotencyKeyConflictError();
        }
        const current = await findTransactionById(input.transactionId);
        if (!current) {
          throw new Error("Failed to replay withdrawal transaction edit: transaction no longer exists");
        }
        return { transaction: current, edited: false };
      }

      try {
        const updated = await database.transaction(async (tx) => {
          // `.for("update")` -- load-bearing under concurrent edits of the
          // SAME withdrawal, mirroring `createInvestmentTransactionPort.editTransaction`'s
          // identical `.for("update")` call's own doc comment (spec-3-7's
          // Review Triage Log, row 1): a plain `SELECT` doesn't re-check
          // after waiting on another transaction's row lock, so two
          // concurrent, genuinely different edits of the same row could
          // otherwise let the second one write a stale `audit_log.oldValue`.
          const existingRows = await tx
            .select()
            .from(withdrawalTransactions)
            .where(eq(withdrawalTransactions.id, input.transactionId))
            .for("update")
            .limit(1);
          const previousRow = existingRows[0];
          if (!previousRow) {
            throw new Error("Failed to edit withdrawal transaction: not found");
          }
          // The AUTHORITATIVE already-cancelled check -- must run inside
          // this same locked transaction, immediately after acquiring the
          // `FOR UPDATE` lock, mirroring `createInvestmentTransactionPort.editTransaction`'s
          // identical Story 3.8 fix one ledger over. `packages/core`'s
          // `editWithdrawalTransaction` own early guard (a separate, earlier
          // round trip) is a fast-fail optimization only, not sufficient on
          // its own to close the race against a concurrent `cancelTransaction`.
          assertWithdrawalNotCancelled(previousRow.status as "active" | "cancelled");

          // The AUTHORITATIVE amount-locked-by-allocation check (this
          // story's Decisions #5, no investment-side equivalent) -- a fresh
          // `listByWithdrawalTransactionId` read taken AFTER the lock above
          // is acquired, so a concurrent `recordDestinationAllocation` call
          // that commits its legs between `packages/core`'s own early guard
          // and this point is still correctly seen here.
          const allocationPort = createWithdrawalDestinationAllocationPort(tx);
          const legs = await allocationPort.listByWithdrawalTransactionId(input.transactionId);
          const amountChanged = !moneyEquals(previousRow.amount as Money, input.amount);
          assertAmountEditable(legs.length > 0, amountChanged);

          const [updatedRow] = await tx
            .update(withdrawalTransactions)
            .set({
              amount: input.amount,
              transactionDate: input.transactionDate,
              paymentMode: input.paymentMode,
              referenceNumber: input.referenceNumber,
              notes: input.notes,
            })
            .where(eq(withdrawalTransactions.id, input.transactionId))
            .returning();
          if (!updatedRow) {
            throw new Error("Failed to edit withdrawal transaction");
          }

          await tx.insert(auditLog).values({
            id: uuidv7(),
            entityType: "withdrawal_transaction",
            entityId: input.transactionId,
            action: "edit",
            actorUserId: input.actorUserId,
            oldValue: previousRow,
            newValue: updatedRow,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
          });

          return updatedRow;
        });

        return { transaction: toWithdrawalTransaction(updated), edited: true };
      } catch (error) {
        if (error instanceof WithdrawalAlreadyCancelledError || error instanceof WithdrawalAmountLockedByAllocationError) {
          throw error;
        }
        if (isUniqueViolation(error)) {
          const winner = await findAuditEntryByIdempotencyKey(input.idempotencyKey);
          if (winner) {
            if (!matchesEditWithdrawalRequest(winner, input)) {
              throw new WithdrawalIdempotencyKeyConflictError();
            }
            const current = await findTransactionById(input.transactionId);
            if (current) {
              return { transaction: current, edited: false };
            }
          }
        }
        throw error;
      }
    },
    /**
     * Story 4.11's `cancelTransaction` -- mirrors
     * `createInvestmentTransactionPort.cancelTransaction`'s exact
     * check-first-then-write-then-recover idempotency structure, extended
     * with the genuinely new cross-cutting concern this story adds: a
     * cascade to every linked destination-allocation leg
     * (`cancelWithdrawalBundle()`, packages/core, AD-9), run inside the same
     * `database.transaction()` as the withdrawal's own status flip and
     * reversal-row insert -- so any cascade step's failure (most notably
     * `InsufficientAvailableBalanceError`, this story's Decisions #2) rolls
     * back EVERYTHING, including the would-be status flip and reversal
     * insert. No partial cancel, ever.
     *
     * 1. `SELECT` `audit_log` by `idempotencyKey` first -- a straightforward
     *    replay, mirroring `editTransaction`'s identical first step.
     * 2. Otherwise, inside one `database.transaction()`: `SELECT ... FOR
     *    UPDATE` the withdrawal row. If its `status` is already
     *    `"cancelled"`, either (a) a genuinely new cancel attempt on an
     *    already-void withdrawal -- `WithdrawalAlreadyCancelledError` -- or
     *    (b) the concurrent-double-submit race: another request carrying
     *    this EXACT `idempotencyKey` won the lock first and already
     *    committed. (b) is detected by finding an `audit_log` "cancel" entry
     *    for this withdrawal with this exact `idempotencyKey` (queried
     *    against `tx`) -- if found, resolves to the same idempotent-replay
     *    result (`cancelled: false`) instead of throwing.
     * 3. Otherwise (still active): fetch every destination-allocation leg
     *    (`createWithdrawalDestinationAllocationPort(tx).listByWithdrawalTransactionId`),
     *    build transaction-bound `createMoneyMovementPort(tx)`/
     *    `createInvestmentTransactionPort(tx)`/`createAvailableBalancePort(tx)`,
     *    call `cancelWithdrawalBundle()` -- any error it throws
     *    (`InsufficientAvailableBalanceError`, or an investment-side
     *    `AlreadyCancelledError` if a "project" leg's destination row was
     *    somehow already independently cancelled) propagates straight out of
     *    this whole `database.transaction()` call, rolling back every write
     *    the cascade already made plus the withdrawal's own would-be status
     *    flip/reversal insert -- none of them happen at all. Only once the
     *    cascade fully succeeds: `UPDATE` the original row's `status` to
     *    `"cancelled"`, `INSERT` the reversal row (a fresh `idempotencyKey`
     *    of its own, mirroring the investment side's identical rationale),
     *    `INSERT` the paired `audit_log` "cancel" entry.
     * 4. Defense in depth, mirroring `editTransaction`'s final catch block:
     *    if the `audit_log` insert still throws a unique-violation, catch
     *    it, re-`SELECT` by `idempotencyKey`, and apply
     *    `matchesCancelWithdrawalRequest`: match -> replay result; mismatch
     *    -> `WithdrawalIdempotencyKeyConflictError`.
     */
    async cancelTransaction(input) {
      const existingEntry = await findAuditEntryByIdempotencyKey(input.idempotencyKey);
      if (existingEntry) {
        if (!matchesCancelWithdrawalRequest(existingEntry, input)) {
          throw new WithdrawalIdempotencyKeyConflictError();
        }
        const original = await findTransactionById(input.transactionId);
        const reversal = original ? await findWithdrawalReversalRow(database, input.transactionId) : null;
        if (!original || !reversal) {
          throw new Error(
            "Failed to replay withdrawal transaction cancel: original or reversal transaction no longer exists",
          );
        }
        return {
          originalTransaction: original,
          reversalTransaction: toWithdrawalTransaction(reversal),
          cancelled: false,
        };
      }

      try {
        return await database.transaction(async (tx) => {
          const existingRows = await tx
            .select()
            .from(withdrawalTransactions)
            .where(eq(withdrawalTransactions.id, input.transactionId))
            .for("update")
            .limit(1);
          const originalRow = existingRows[0];
          if (!originalRow) {
            throw new Error("Failed to cancel withdrawal transaction: not found");
          }

          if (originalRow.status === "cancelled") {
            const raceWinnerRows = await tx
              .select()
              .from(auditLog)
              .where(
                and(
                  eq(auditLog.entityType, "withdrawal_transaction"),
                  eq(auditLog.entityId, input.transactionId),
                  eq(auditLog.idempotencyKey, input.idempotencyKey),
                ),
              )
              .limit(1);
            if (!raceWinnerRows[0]) {
              throw new WithdrawalAlreadyCancelledError();
            }
            const reversalRow = await findWithdrawalReversalRow(tx, input.transactionId);
            if (!reversalRow) {
              throw new Error(
                "Failed to recover withdrawal transaction cancel: reversal transaction no longer exists",
              );
            }
            return {
              originalTransaction: toWithdrawalTransaction(originalRow),
              reversalTransaction: toWithdrawalTransaction(reversalRow),
              cancelled: false,
            };
          }

          const allocationPort = createWithdrawalDestinationAllocationPort(tx);
          const legs = await allocationPort.listByWithdrawalTransactionId(input.transactionId);

          const moneyMovementPort = createMoneyMovementPort(tx);
          const investmentTransactionPort = createInvestmentTransactionPort(tx);
          const availableBalancePort = createAvailableBalancePort(tx);
          await cancelWithdrawalBundle(
            toWithdrawalTransaction(originalRow),
            legs,
            input.idempotencyKey,
            input.actorUserId,
            {
              moneyMovements: moneyMovementPort,
              investmentTransactions: investmentTransactionPort,
              availableBalances: availableBalancePort,
            },
          );

          const [updatedOriginal] = await tx
            .update(withdrawalTransactions)
            .set({ status: "cancelled" })
            .where(eq(withdrawalTransactions.id, input.transactionId))
            .returning();
          if (!updatedOriginal) {
            throw new Error("Failed to cancel withdrawal transaction");
          }

          const [reversalRow] = await tx
            .insert(withdrawalTransactions)
            .values({
              id: uuidv7(),
              projectId: originalRow.projectId,
              partyType: originalRow.partyType,
              shareId: originalRow.shareId,
              sharePercentSnapshot: originalRow.sharePercentSnapshot,
              canTakeSnapshot: originalRow.canTakeSnapshot,
              amount: originalRow.amount,
              transactionDate: originalRow.transactionDate,
              paymentMode: originalRow.paymentMode,
              referenceNumber: originalRow.referenceNumber,
              notes: originalRow.notes,
              idempotencyKey: uuidv7(),
              status: "cancelled",
              reversalOfTransactionId: input.transactionId,
            })
            .returning();
          if (!reversalRow) {
            throw new Error("Failed to create reversal withdrawal transaction");
          }

          await tx.insert(auditLog).values({
            id: uuidv7(),
            entityType: "withdrawal_transaction",
            entityId: input.transactionId,
            action: "cancel",
            actorUserId: input.actorUserId,
            oldValue: originalRow,
            newValue: updatedOriginal,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
          });

          return {
            originalTransaction: toWithdrawalTransaction(updatedOriginal),
            reversalTransaction: toWithdrawalTransaction(reversalRow),
            cancelled: true,
          };
        });
      } catch (error) {
        if (error instanceof WithdrawalAlreadyCancelledError) {
          throw error;
        }
        if (error instanceof InsufficientAvailableBalanceError) {
          throw error;
        }
        if (isUniqueViolation(error)) {
          const winner = await findAuditEntryByIdempotencyKey(input.idempotencyKey);
          if (winner) {
            if (!matchesCancelWithdrawalRequest(winner, input)) {
              throw new WithdrawalIdempotencyKeyConflictError();
            }
            const original = await findTransactionById(input.transactionId);
            const reversal = original ? await findWithdrawalReversalRow(database, input.transactionId) : null;
            if (original && reversal) {
              return {
                originalTransaction: original,
                reversalTransaction: toWithdrawalTransaction(reversal),
                cancelled: false,
              };
            }
          }
        }
        throw error;
      }
    },
  };
}

/**
 * Drizzle-backed implementation of `packages/core`'s `WithdrawalAdjustmentPort`
 * (Story 4.3) -- mirrors `createInvestmentAdjustmentPort`'s exact
 * `.onConflictDoUpdate(...)` shape one ledger over. `upsert` writes exactly
 * one current row per `(partyType, shareId, projectId)` (this story's
 * Boundaries): the first call for a given key inserts a new row; every later
 * call for the *same* key overwrites that row's `canTake`/`taken`/
 * `adjustmentType`/`adjustmentAmount`/`updatedAt` in place, targeting the
 * table's UNIQUE `(partyType, shareId, projectId)` constraint
 * (`withdrawal_adjustments_party_share_project_unique`) -- never a second row
 * for the same person, and never a duplicate on a re-view with no new
 * withdrawal transactions in between.
 */
export function createWithdrawalAdjustmentPort(
  database: Database = getDb(),
): WithdrawalAdjustmentPort {
  return {
    async upsert(input) {
      const [row] = await database
        .insert(withdrawalAdjustments)
        .values({
          id: uuidv7(),
          projectId: input.projectId,
          partyType: input.partyType,
          shareId: input.shareId,
          canTake: input.canTake,
          taken: input.taken,
          adjustmentAmount: input.adjustmentAmount,
          adjustmentType: input.adjustmentType,
        })
        .onConflictDoUpdate({
          target: [
            withdrawalAdjustments.partyType,
            withdrawalAdjustments.shareId,
            withdrawalAdjustments.projectId,
          ],
          set: {
            canTake: input.canTake,
            taken: input.taken,
            adjustmentAmount: input.adjustmentAmount,
            adjustmentType: input.adjustmentType,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!row) {
        throw new Error("Failed to upsert withdrawal adjustment");
      }
      return toWithdrawalAdjustment(row);
    },
    async listByProjectId(projectId) {
      const rows = await database
        .select()
        .from(withdrawalAdjustments)
        .where(eq(withdrawalAdjustments.projectId, projectId));
      return rows.map(toWithdrawalAdjustment);
    },
    /** Story 5.3 (FR33/FR34) -- mirrors `createInvestmentAdjustmentPort.listAll`'s identical shape one ledger over. */
    async listAll() {
      const rows = await database.select().from(withdrawalAdjustments);
      return rows.map(toWithdrawalAdjustment);
    },
  };
}

/**
 * Drizzle-backed implementation of `packages/core`'s `InvestmentTransactionPort`
 * (Story 3.3) -- the first port method in this codebase to use Drizzle's
 * `database.transaction(async (tx) => {...})` API, implementing AD-5's
 * "transaction insert + audit_log insert, atomically" requirement entirely
 * inside this module (invisible to `packages/core`, which never imports a
 * DB driver -- AD-9).
 *
 * `recordTransaction`'s idempotency handling, in order:
 * 1. `SELECT` by `idempotencyKey` first -- if a row already exists AND it
 *    `matchesRequest` the current `input` (same `requirementId`/`shareId`/
 *    `partyType`/`amount`), return it immediately (`created: false`), no
 *    transaction attempted at all (the straightforward replay case). If a
 *    row exists but does NOT match, this is a genuine key collision between
 *    two unrelated requests -- throw `IdempotencyKeyConflictError` rather
 *    than silently returning the mismatched row.
 * 2. Otherwise (no existing row), insert the transaction row and its paired
 *    `audit_log` row together inside one `database.transaction()` call
 *    (`created: true`).
 * 3. If that insert throws because of the `idempotency_key` UNIQUE
 *    constraint (SQL state `23505`) -- a concurrent double-submit that raced
 *    step 1 -- catch it, re-`SELECT` by `idempotencyKey`, and apply the same
 *    `matchesRequest` check to the winning row: match -> return it
 *    (`created: false`) instead of propagating the error; mismatch ->
 *    `IdempotencyKeyConflictError`. Any other error still propagates
 *    unchanged.
 */
export function createInvestmentTransactionPort(
  database: Database = getDb(),
): InvestmentTransactionPort {
  async function findByIdempotencyKey(idempotencyKey: string): Promise<InvestmentTransaction | null> {
    const rows = await database
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.idempotencyKey, idempotencyKey))
      .limit(1);
    const row = rows[0];
    return row ? toInvestmentTransaction(row) : null;
  }

  /** Shared by `findById` and `editTransaction`'s idempotent-replay paths. */
  async function findTransactionById(id: string): Promise<InvestmentTransaction | null> {
    const rows = await database
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.id, id))
      .limit(1);
    const row = rows[0];
    return row ? toInvestmentTransaction(row) : null;
  }

  /** Shared by `editTransaction`'s/`cancelTransaction`'s straightforward-replay and concurrent-race-recovery paths. */
  async function findAuditEntryByIdempotencyKey(idempotencyKey: string): Promise<AuditLogRow | null> {
    const rows = await database
      .select()
      .from(auditLog)
      .where(eq(auditLog.idempotencyKey, idempotencyKey))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * The reversal row linked to one original transaction (Story 3.8) -- shared
   * by `cancelTransaction`'s straightforward-replay path (queried against
   * `database`, outside any transaction) and its concurrent-race-recovery
   * paths (queried against `tx`, so a request unblocked by another's
   * just-committed `FOR UPDATE` lock sees that same commit's reversal row).
   * `executor` accepts either since both `Database` and a Drizzle transaction
   * handle (`tx`) expose the identical `.select()` query-builder shape.
   */
  async function findReversalRow(
    executor: Pick<Database, "select">,
    originalTransactionId: string,
  ): Promise<InvestmentTransactionRow | null> {
    const rows = await executor
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.reversalOfTransactionId, originalTransactionId))
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    async recordTransaction(input) {
      const existing = await findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        if (!matchesRequest(existing, input)) {
          throw new IdempotencyKeyConflictError();
        }
        return { transaction: existing, created: false };
      }

      try {
        const inserted = await database.transaction(async (tx) => {
          const [transactionRow] = await tx
            .insert(investmentTransactions)
            .values({
              id: uuidv7(),
              requirementId: input.requirementId,
              projectId: input.projectId,
              partyType: input.partyType,
              shareId: input.shareId,
              sharePercentSnapshot: input.sharePercentSnapshot,
              shouldPaySnapshot: input.shouldPaySnapshot,
              amount: input.amount,
              transactionDate: input.transactionDate,
              paymentMode: input.paymentMode,
              referenceNumber: input.referenceNumber,
              notes: input.notes,
              idempotencyKey: input.idempotencyKey,
            })
            .returning();
          if (!transactionRow) {
            throw new Error("Failed to record investment transaction");
          }

          await tx.insert(auditLog).values({
            id: uuidv7(),
            entityType: "investment_transaction",
            entityId: transactionRow.id,
            action: "create",
            actorUserId: input.actorUserId,
            oldValue: null,
            newValue: transactionRow,
            reason: null,
          });

          return transactionRow;
        });

        return { transaction: toInvestmentTransaction(inserted), created: true };
      } catch (error) {
        if (isUniqueViolation(error)) {
          const winner = await findByIdempotencyKey(input.idempotencyKey);
          if (winner) {
            if (!matchesRequest(winner, input)) {
              throw new IdempotencyKeyConflictError();
            }
            return { transaction: winner, created: false };
          }
        }
        throw error;
      }
    },
    async listByRequirementId(requirementId) {
      const rows = await database
        .select()
        .from(investmentTransactions)
        .where(eq(investmentTransactions.requirementId, requirementId))
        .orderBy(asc(investmentTransactions.createdAt));
      return rows.map(toInvestmentTransaction);
    },
    async findById(id) {
      return findTransactionById(id);
    },
    /** Story 5.1 (FR31) -- mirrors `createPartnerSharePort.listAll`'s plain, unfiltered shape. */
    async listAll() {
      const rows = await database.select().from(investmentTransactions);
      return rows.map(toInvestmentTransaction);
    },
    /**
     * Story 3.7's `editTransaction` -- mirrors `recordTransaction`'s
     * atomicity/idempotency structure exactly, one level over: idempotency
     * is checked against `audit_log.idempotencyKey` (never
     * `investment_transactions.idempotencyKey`, which belongs to the
     * original create), since an edit updates an existing row rather than
     * inserting a new one.
     */
    async editTransaction(input) {
      const existingEntry = await findAuditEntryByIdempotencyKey(input.idempotencyKey);
      if (existingEntry) {
        if (!matchesEditRequest(existingEntry, input)) {
          throw new IdempotencyKeyConflictError();
        }
        const current = await findTransactionById(input.transactionId);
        if (!current) {
          throw new Error("Failed to replay investment transaction edit: transaction no longer exists");
        }
        return { transaction: current, edited: false };
      }

      try {
        const updated = await database.transaction(async (tx) => {
          // `.for("update")` (SELECT ... FOR UPDATE), not a plain SELECT --
          // load-bearing under concurrent edits of the SAME transaction.
          // Postgres's default READ COMMITTED isolation does NOT re-check a
          // plain SELECT's result after waiting on another transaction's row
          // lock; only FOR UPDATE (or an UPDATE's own row-recheck) does. Two
          // concurrent, genuinely different edits of the same row: without
          // this, the second request could read the row *before* the first
          // request's commit, then -- after being blocked and released by
          // the first request's UPDATE -- write an `audit_log` "edit" entry
          // whose `oldValue` is that stale pre-first-edit snapshot instead
          // of the true immediately-prior state, silently erasing the first
          // edit from the audit trail (spec-3-7's Review Triage Log, row 1).
          // With FOR UPDATE, this SELECT blocks until the first request's
          // transaction commits and releases its lock, then reads the
          // freshly-committed row.
          const existingRows = await tx
            .select()
            .from(investmentTransactions)
            .where(eq(investmentTransactions.id, input.transactionId))
            .for("update")
            .limit(1);
          const previousRow = existingRows[0];
          if (!previousRow) {
            throw new Error("Failed to edit investment transaction: not found");
          }
          // Story 3.8 fix (spec-3-8's Review Triage Log, row 1): the
          // AUTHORITATIVE already-cancelled check -- must run inside this
          // same locked transaction, immediately after acquiring the
          // `FOR UPDATE` lock, mirroring `cancelTransaction`'s own
          // `originalRow.status === "cancelled"` check one level over. A
          // non-locking check in `packages/core`'s `editInvestmentTransaction`
          // (a separate, earlier round trip) is NOT sufficient on its own:
          // it can pass against a still-`active` row, then lose a race to a
          // concurrent `cancelTransaction` call that acquires this row's
          // lock first, flips its status, and commits before this edit ever
          // reaches its own `FOR UPDATE` read -- silently mutating a closed
          // financial record and diverging it from its own reversal row's
          // pre-edit snapshot. This check, under the lock, is what actually
          // closes that race.
          if (previousRow.status === "cancelled") {
            throw new AlreadyCancelledError();
          }

          const [updatedRow] = await tx
            .update(investmentTransactions)
            .set({
              amount: input.amount,
              transactionDate: input.transactionDate,
              paymentMode: input.paymentMode,
              referenceNumber: input.referenceNumber,
              notes: input.notes,
            })
            .where(eq(investmentTransactions.id, input.transactionId))
            .returning();
          if (!updatedRow) {
            throw new Error("Failed to edit investment transaction");
          }

          await tx.insert(auditLog).values({
            id: uuidv7(),
            entityType: "investment_transaction",
            entityId: input.transactionId,
            action: "edit",
            actorUserId: input.actorUserId,
            oldValue: previousRow,
            newValue: updatedRow,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
          });

          return updatedRow;
        });

        return { transaction: toInvestmentTransaction(updated), edited: true };
      } catch (error) {
        if (isUniqueViolation(error)) {
          const winner = await findAuditEntryByIdempotencyKey(input.idempotencyKey);
          if (winner) {
            if (!matchesEditRequest(winner, input)) {
              throw new IdempotencyKeyConflictError();
            }
            const current = await findTransactionById(input.transactionId);
            if (current) {
              return { transaction: current, edited: false };
            }
          }
        }
        throw error;
      }
    },
    async findAuditLogByTransactionId(transactionId) {
      const rows = await database
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.entityType, "investment_transaction"), eq(auditLog.entityId, transactionId)),
        )
        .orderBy(asc(auditLog.createdAt));
      return rows.map(toAuditLogEntry);
    },
    /**
     * Story 3.8's `cancelTransaction` (FR42) -- mirrors `editTransaction`'s
     * check-first-then-write-then-recover idempotency structure, plus one
     * more piece `editTransaction` doesn't need: an already-cancelled guard.
     *
     * 1. `SELECT` `audit_log` by `idempotencyKey` first -- a straightforward
     *    replay, mirroring `editTransaction`'s identical first step.
     * 2. Otherwise, inside one `database.transaction()`: `SELECT ... FOR
     *    UPDATE` the original row (mirrors `editTransaction`'s Story 3.7
     *    patch-round fix exactly, for the identical concurrency-correctness
     *    reason -- see that `.for("update")` call's own doc comment above).
     *    If its `status` is already `"cancelled"`, this is either (a) a
     *    genuinely new cancel attempt on an already-void transaction --
     *    `AlreadyCancelledError` -- or (b) the concurrent-double-submit race:
     *    another request carrying this EXACT `idempotencyKey` won the lock
     *    first and already committed its cancel+reversal+audit_log write
     *    before this request's `FOR UPDATE` unblocked. (b) is detected by
     *    finding an `audit_log` "cancel" entry for this transaction with
     *    this exact `idempotencyKey` (queried against `tx`, so it sees that
     *    just-committed row) -- if found, this call resolves to the same
     *    idempotent-replay result (`cancelled: false`) instead of throwing.
     * 3. Otherwise (still active), `UPDATE` the original row's `status` to
     *    `"cancelled"`, `INSERT` the reversal row (a fresh `idempotencyKey`
     *    of its own -- `investment_transactions.idempotencyKey` is NOT NULL
     *    UNIQUE, but this system-generated row was never a caller-submitted
     *    request in its own right, so it needs no caller-facing identity),
     *    `INSERT` the paired `audit_log` "cancel" entry.
     * 4. Defense in depth, mirroring `editTransaction`'s final catch block
     *    exactly: if the `audit_log` insert still throws a unique-violation
     *    (a same-`idempotencyKey`-but-different-`transactionId` collision --
     *    two different rows can't race under the same `FOR UPDATE` lock, so
     *    this is the one race `FOR UPDATE` alone can't prevent), catch it,
     *    re-`SELECT` by `idempotencyKey`, and apply `matchesCancelRequest`:
     *    match -> replay result; mismatch -> `IdempotencyKeyConflictError`.
     */
    async cancelTransaction(input) {
      const existingEntry = await findAuditEntryByIdempotencyKey(input.idempotencyKey);
      if (existingEntry) {
        if (!matchesCancelRequest(existingEntry, input)) {
          throw new IdempotencyKeyConflictError();
        }
        const original = await findTransactionById(input.transactionId);
        const reversal = original ? await findReversalRow(database, input.transactionId) : null;
        if (!original || !reversal) {
          throw new Error(
            "Failed to replay investment transaction cancel: original or reversal transaction no longer exists",
          );
        }
        return {
          originalTransaction: original,
          reversalTransaction: toInvestmentTransaction(reversal),
          cancelled: false,
        };
      }

      try {
        return await database.transaction(async (tx) => {
          const existingRows = await tx
            .select()
            .from(investmentTransactions)
            .where(eq(investmentTransactions.id, input.transactionId))
            .for("update")
            .limit(1);
          const originalRow = existingRows[0];
          if (!originalRow) {
            throw new Error("Failed to cancel investment transaction: not found");
          }

          if (originalRow.status === "cancelled") {
            const raceWinnerRows = await tx
              .select()
              .from(auditLog)
              .where(
                and(
                  eq(auditLog.entityType, "investment_transaction"),
                  eq(auditLog.entityId, input.transactionId),
                  eq(auditLog.idempotencyKey, input.idempotencyKey),
                ),
              )
              .limit(1);
            if (!raceWinnerRows[0]) {
              throw new AlreadyCancelledError();
            }
            const reversalRow = await findReversalRow(tx, input.transactionId);
            if (!reversalRow) {
              throw new Error(
                "Failed to recover investment transaction cancel: reversal transaction no longer exists",
              );
            }
            return {
              originalTransaction: toInvestmentTransaction(originalRow),
              reversalTransaction: toInvestmentTransaction(reversalRow),
              cancelled: false,
            };
          }

          const [updatedOriginal] = await tx
            .update(investmentTransactions)
            .set({ status: "cancelled" })
            .where(eq(investmentTransactions.id, input.transactionId))
            .returning();
          if (!updatedOriginal) {
            throw new Error("Failed to cancel investment transaction");
          }

          const [reversalRow] = await tx
            .insert(investmentTransactions)
            .values({
              id: uuidv7(),
              requirementId: originalRow.requirementId,
              projectId: originalRow.projectId,
              partyType: originalRow.partyType,
              shareId: originalRow.shareId,
              sharePercentSnapshot: originalRow.sharePercentSnapshot,
              shouldPaySnapshot: originalRow.shouldPaySnapshot,
              amount: originalRow.amount,
              transactionDate: originalRow.transactionDate,
              paymentMode: originalRow.paymentMode,
              referenceNumber: originalRow.referenceNumber,
              notes: originalRow.notes,
              idempotencyKey: uuidv7(),
              status: "cancelled",
              reversalOfTransactionId: input.transactionId,
            })
            .returning();
          if (!reversalRow) {
            throw new Error("Failed to create reversal transaction");
          }

          await tx.insert(auditLog).values({
            id: uuidv7(),
            entityType: "investment_transaction",
            entityId: input.transactionId,
            action: "cancel",
            actorUserId: input.actorUserId,
            oldValue: originalRow,
            newValue: updatedOriginal,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
          });

          return {
            originalTransaction: toInvestmentTransaction(updatedOriginal),
            reversalTransaction: toInvestmentTransaction(reversalRow),
            cancelled: true,
          };
        });
      } catch (error) {
        if (error instanceof AlreadyCancelledError) {
          throw error;
        }
        if (isUniqueViolation(error)) {
          const winner = await findAuditEntryByIdempotencyKey(input.idempotencyKey);
          if (winner) {
            if (!matchesCancelRequest(winner, input)) {
              throw new IdempotencyKeyConflictError();
            }
            const original = await findTransactionById(input.transactionId);
            const reversal = original ? await findReversalRow(database, input.transactionId) : null;
            if (original && reversal) {
              return {
                originalTransaction: original,
                reversalTransaction: toInvestmentTransaction(reversal),
                cancelled: false,
              };
            }
          }
        }
        throw error;
      }
    },
    /**
     * Story 4.1: a DB-side `SUM(amount)` filtered to `status = 'active'` rows
     * for `projectId`, across every one of the Project's funding requirements
     * -- never fetched row-by-row and added client-side (AD-2 reserves actual
     * arithmetic on money values for `packages/core/src/decimal-math.ts`; this
     * is Postgres doing the addition, not application code). `coalesce(...,
     * 0)` covers the zero-active-transactions case (a brand-new Project, or
     * one whose only transactions are cancelled) -- `SUM` over zero rows is
     * SQL `NULL`, which would otherwise need a separate null-check here.
     */
    async sumActiveAmountByProjectId(projectId) {
      const [row] = await database
        .select({
          total: sql<string>`coalesce(sum(${investmentTransactions.amount}), 0)`,
        })
        .from(investmentTransactions)
        .where(
          and(eq(investmentTransactions.projectId, projectId), eq(investmentTransactions.status, "active")),
        );
      return (row?.total ?? "0") as Money;
    },
  };
}

/**
 * Drizzle-backed implementation of `packages/core`'s `InvestmentAdjustmentPort`
 * (Story 3.4) -- the first port method in this codebase to use Drizzle's
 * `.onConflictDoUpdate(...)` API. `upsert` writes exactly one current row per
 * `(partyType, shareId, projectId)` (this story's Boundaries): the first call
 * for a given key inserts a new row; every later call for the *same* key
 * overwrites that row's `requirementId`/`shouldPay`/`actualPaid`/
 * `adjustmentType`/`adjustmentAmount`/`updatedAt` in place, targeting the
 * table's UNIQUE `(partyType, shareId, projectId)` constraint
 * (`investment_adjustments_party_share_project_unique`) -- never a second
 * row for the same person, and never a duplicate on a re-view with no new
 * transactions in between.
 */
export function createInvestmentAdjustmentPort(
  database: Database = getDb(),
): InvestmentAdjustmentPort {
  return {
    async upsert(input) {
      const [row] = await database
        .insert(investmentAdjustments)
        .values({
          id: uuidv7(),
          projectId: input.projectId,
          partyType: input.partyType,
          shareId: input.shareId,
          requirementId: input.requirementId,
          shouldPay: input.shouldPay,
          actualPaid: input.actualPaid,
          adjustmentAmount: input.adjustmentAmount,
          adjustmentType: input.adjustmentType,
        })
        .onConflictDoUpdate({
          target: [
            investmentAdjustments.partyType,
            investmentAdjustments.shareId,
            investmentAdjustments.projectId,
          ],
          set: {
            requirementId: input.requirementId,
            shouldPay: input.shouldPay,
            actualPaid: input.actualPaid,
            adjustmentAmount: input.adjustmentAmount,
            adjustmentType: input.adjustmentType,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!row) {
        throw new Error("Failed to upsert investment adjustment");
      }
      return toInvestmentAdjustment(row);
    },
    async listByProjectId(projectId) {
      const rows = await database
        .select()
        .from(investmentAdjustments)
        .where(eq(investmentAdjustments.projectId, projectId));
      return rows.map(toInvestmentAdjustment);
    },
    /** Story 5.3 (FR33/FR34) -- mirrors `createInvestmentTransactionPort.listAll`'s identical Story 5.1 shape one ledger over. */
    async listAll() {
      const rows = await database.select().from(investmentAdjustments);
      return rows.map(toInvestmentAdjustment);
    },
  };
}

/**
 * Drizzle-backed implementation of `packages/core`'s `RecommendedAmountPort`
 * (Story 3.5). Unlike `createInvestmentAdjustmentPort`'s `upsert`,
 * `snapshotAll` is a plain multi-row insert -- never `onConflictDoUpdate` --
 * a requirement's Recommended Amount is written exactly once, at creation
 * time (this story's Decisions); the table's UNIQUE `(requirementId,
 * partyType, shareId)` constraint exists purely as a data-integrity guard,
 * not an upsert-conflict target.
 *
 * `snapshotAll` wraps the insert in `database.transaction(...)` -- mirroring
 * `createInvestmentTransactionPort.recordTransaction`'s atomic-multi-write
 * precedent -- so every Partner/Sub-partner's row for one requirement is
 * written all-or-nothing: if the write fails partway (e.g. a transient
 * connection error), the transaction rolls back and NO rows are committed,
 * rather than leaving a silent partial snapshot (Review Triage Log row 1).
 */
export function createRecommendedAmountPort(database: Database = getDb()): RecommendedAmountPort {
  return {
    async snapshotAll(inputs) {
      if (inputs.length === 0) {
        return [];
      }
      return database.transaction(async (tx) => {
        const rows = await tx
          .insert(recommendedAmounts)
          .values(
            inputs.map((input) => ({
              id: uuidv7(),
              requirementId: input.requirementId,
              projectId: input.projectId,
              partyType: input.partyType,
              shareId: input.shareId,
              baseAmount: input.baseAmount,
              previousPending: input.previousPending,
              previousExtraPaid: input.previousExtraPaid,
              recommendedAmount: input.recommendedAmount,
            })),
          )
          .returning();
        if (rows.length !== inputs.length) {
          throw new Error("Failed to snapshot all recommended amounts");
        }
        return rows.map(toRecommendedAmount);
      });
    },
    async findByRequirementId(requirementId) {
      const rows = await database
        .select()
        .from(recommendedAmounts)
        .where(eq(recommendedAmounts.requirementId, requirementId));
      return rows.map(toRecommendedAmount);
    },
  };
}

/**
 * Drizzle-backed implementation of `packages/core`'s
 * `WithdrawalDestinationAllocationPort` (Story 4.7, FR27) -- the atomic,
 * write-once, idempotency-aware multi-row insert this port's own interface
 * doc comment describes.
 *
 * `recordAllocation` deliberately does everything inside one
 * `database.transaction()` call, guarded by a `SELECT ... FOR UPDATE` lock
 * on the parent `withdrawal_transactions` row, rather than the
 * check-by-idempotencyKey-then-separately-transact shape
 * `createWithdrawalTransactionPort.recordTransaction` uses one story over:
 * this table's `idempotencyKey` column is deliberately NOT unique (schema.ts
 * -- a single save legitimately inserts several sibling rows sharing one
 * key), so there is no UNIQUE-constraint-violation signal a concurrent
 * double-submit could race against and recover from afterward the way that
 * port's `isUniqueViolation` catch-and-retry does. Locking the one row every
 * concurrent allocation attempt for this withdrawal must agree exists
 * (`withdrawal_transactions.id`) serializes them instead, so the "does an
 * allocation already exist for this withdrawal, and does it match this
 * request" check below is always answered against a fully committed,
 * lock-consistent view -- no TOCTOU window between reading and writing.
 *
 * Sequence, once the lock is held:
 * 1. Read every existing `withdrawal_destination_allocations` row for
 *    `withdrawalTransactionId`. Empty -- proceed to step 2. Non-empty --
 *    this withdrawal was already allocated (possibly by this exact request,
 *    replayed):
 *    - every existing row shares `idempotencyKey` AND `matchesAllocationRequest`
 *      the current `legs` -- a legitimate replay: return the existing rows
 *      unchanged (`created: false`), no write.
 *    - every existing row shares `idempotencyKey` but the content differs --
 *      a genuine collision under the same key -- throw
 *      `WithdrawalDestinationAllocationIdempotencyKeyConflictError`.
 *    - the existing rows carry a *different* `idempotencyKey` -- a second,
 *      unrelated allocation attempt on an already-allocated withdrawal (this
 *      story's Decisions: write-once) -- throw `AlreadyAllocatedError`.
 * 2. No existing rows for this withdrawal -- but `idempotencyKey` might
 *    still already be in use by a *different* withdrawal's allocation (an
 *    unrelated collision, not scoped to `withdrawalTransactionId` at all) --
 *    throw `WithdrawalDestinationAllocationIdempotencyKeyConflictError` if
 *    so.
 * 3. Otherwise, insert every leg row plus exactly one paired `audit_log` row
 *    (`entityType: "withdrawal_destination_allocation"`, `entityId` =
 *    `withdrawalTransactionId`, `newValue` = the full inserted leg array) --
 *    `created: true`.
 *
 * Story 4.8 (FR28, AD-6) extension to step 3: for every `"project"` leg
 * (identified by its own pre-generated `id`, not `.returning()`'s row order,
 * which Postgres/Drizzle never guarantees to mirror `legs`' input order --
 * see `matchesAllocationRequest`'s own doc comment for the identical
 * precedent), also calls `moveWithdrawalToProject()` with
 * `createInvestmentTransactionPort(tx)`/`createMoneyMovementPort(tx)` --
 * transaction-bound ports constructed inside this same `database.transaction()`
 * call, so the destination `investment_transactions` row and its linking
 * `money_movements` row commit or roll back together with every leg row and
 * the paired `audit_log` row, all as one atomic unit (AC3). Each "project"
 * leg's derived idempotency key is `` `${idempotencyKey}:move:${legIndex}` ``
 * (this story's Decisions), `legIndex` being that leg's position in the
 * caller's own `legs` array (not `insertedRows`' unordered return). Called
 * sequentially (never `Promise.all`) -- multiple queries against the same
 * open transaction/connection must not run concurrently. Any error thrown
 * from within (`ShareNotFoundError`/`SharesNotFullyAllocatedError`/
 * `SubPartnerSharesOverAllocatedError`) propagates out of this whole
 * `database.transaction()` call, rolling back every row this call would
 * otherwise have written -- no partial allocation, no partial investment/
 * movement rows (this story's I/O matrix).
 *
 * On the replay path (step 1's "legitimate replay" branch), this call reads
 * back the *already-linked* `money_movements` rows for the matched
 * `existingRows` (never re-creates them) so the response still carries them.
 */
export function createWithdrawalDestinationAllocationPort(
  database: Database = getDb(),
): WithdrawalDestinationAllocationPort {
  return {
    async recordAllocation(withdrawalTransactionId, legs, idempotencyKey, actorUserId) {
      return database.transaction(async (tx) => {
        const [withdrawalRow] = await tx
          .select({
            id: withdrawalTransactions.id,
            projectId: withdrawalTransactions.projectId,
            // Story 4.9 (FR29): also selected so an "available_balance" leg
            // below can credit the ledger keyed to this withdrawal's own
            // (partyType, shareId) -- widening the existing column list, no
            // signature change (this story's Code Map).
            partyType: withdrawalTransactions.partyType,
            shareId: withdrawalTransactions.shareId,
          })
          .from(withdrawalTransactions)
          .where(eq(withdrawalTransactions.id, withdrawalTransactionId))
          .for("update");
        if (!withdrawalRow) {
          throw new Error(`Failed to record withdrawal destination allocation: no withdrawal transaction ${withdrawalTransactionId}`);
        }
        const sourceProjectId = withdrawalRow.projectId;

        const existingRows = await tx
          .select()
          .from(withdrawalDestinationAllocations)
          .where(eq(withdrawalDestinationAllocations.withdrawalTransactionId, withdrawalTransactionId));

        if (existingRows.length > 0) {
          const sameKey = existingRows.every((row) => row.idempotencyKey === idempotencyKey);
          if (sameKey && matchesAllocationRequest(existingRows, legs)) {
            const existingMovements = await tx
              .select()
              .from(moneyMovements)
              .where(
                inArray(
                  moneyMovements.withdrawalDestinationAllocationId,
                  existingRows.map((row) => row.id),
                ),
              );
            return {
              allocations: existingRows.map(toWithdrawalDestinationAllocation),
              moneyMovements: existingMovements.map(toMoneyMovement),
              created: false,
            };
          }
          if (sameKey) {
            throw new WithdrawalDestinationAllocationIdempotencyKeyConflictError();
          }
          throw new AlreadyAllocatedError();
        }

        const keyCollisionRows = await tx
          .select({ id: withdrawalDestinationAllocations.id })
          .from(withdrawalDestinationAllocations)
          .where(eq(withdrawalDestinationAllocations.idempotencyKey, idempotencyKey))
          .limit(1);
        if (keyCollisionRows.length > 0) {
          throw new WithdrawalDestinationAllocationIdempotencyKeyConflictError();
        }

        // Pre-generated (not left to Drizzle/Postgres to assign) so each
        // "project" leg's id is known BEFORE the insert, independent of
        // `.returning()`'s row order -- see this method's own doc comment.
        const legIds = legs.map(() => uuidv7());

        const insertedRows = await tx
          .insert(withdrawalDestinationAllocations)
          .values(
            legs.map((leg, index) => ({
              id: legIds[index] as string,
              withdrawalTransactionId,
              destinationType: leg.destinationType,
              amount: leg.amount,
              destinationProjectId: leg.destinationProjectId,
              personName: leg.personName,
              notes: leg.notes,
              destinationRequirementId: leg.destinationRequirementId,
              destinationShareId: leg.destinationShareId,
              destinationPartyType: leg.destinationPartyType,
              idempotencyKey,
            })),
          )
          .returning();
        if (insertedRows.length !== legs.length) {
          throw new Error("Failed to record withdrawal destination allocation legs");
        }

        await tx.insert(auditLog).values({
          id: uuidv7(),
          entityType: "withdrawal_destination_allocation",
          entityId: withdrawalTransactionId,
          action: "create",
          actorUserId,
          oldValue: null,
          newValue: insertedRows,
          reason: null,
        });

        // Story 4.8: for every "project" leg, auto-create the linked
        // destination investment_transactions row + money_movements row,
        // inside this same transaction (AD-6). Story 4.9 (FR29): for every
        // "available_balance" leg, credit the Available Balance ledger the
        // same way, one leg at a time. Sequential, not Promise.all -- a
        // single open transaction/connection can't serve concurrent
        // queries.
        const createdMovements: MoneyMovement[] = [];
        const investmentTransactionPort = createInvestmentTransactionPort(tx);
        const moneyMovementPort = createMoneyMovementPort(tx);
        const availableBalancePort = createAvailableBalancePort(tx);
        for (let index = 0; index < legs.length; index++) {
          const leg = legs[index];
          if (!leg) continue;
          if (leg.destinationType === "available_balance") {
            // Story 4.9 (FR29, this story's Decisions #4): credited to
            // (withdrawalRow.partyType, withdrawalRow.shareId, sourceProjectId)
            // -- the withdrawal's OWN party/share, never a client-suppliable
            // value -- and the withdrawal's own source Project (never the
            // spend-time destination, this story's Decisions #1). Only
            // reached on a genuine first write (never on replay, this
            // story's Boundaries), same as the "project" leg branch above.
            await availableBalancePort.creditBalance({
              projectId: sourceProjectId,
              partyType: withdrawalRow.partyType as "partner" | "sub_partner",
              shareId: withdrawalRow.shareId,
              amount: leg.amount,
            });
            continue;
          }
          if (leg.destinationType !== "project") continue;
          if (!leg.destinationProjectId || !leg.destinationShareId || !leg.destinationPartyType || !leg.destinationSnapshotInput) {
            throw new Error(
              `Failed to move withdrawal to project: leg ${index} is a "project" leg with no resolved destination snapshot`,
            );
          }
          const { moneyMovement } = await moveWithdrawalToProject(
            legIds[index] as string,
            sourceProjectId,
            leg.destinationProjectId,
            leg.destinationSnapshotInput.requirement,
            leg.destinationSnapshotInput.partnerShares,
            leg.destinationSnapshotInput.subPartnerSharesByPartnerId,
            leg.destinationPartyType,
            leg.destinationShareId,
            leg.amount,
            `${idempotencyKey}:move:${index}`,
            actorUserId,
            { investmentTransactions: investmentTransactionPort, moneyMovements: moneyMovementPort },
          );
          createdMovements.push(moneyMovement);
        }

        return {
          allocations: insertedRows.map(toWithdrawalDestinationAllocation),
          moneyMovements: createdMovements,
          created: true,
        };
      });
    },
    async listByWithdrawalTransactionId(withdrawalTransactionId) {
      const rows = await database
        .select()
        .from(withdrawalDestinationAllocations)
        .where(eq(withdrawalDestinationAllocations.withdrawalTransactionId, withdrawalTransactionId))
        .orderBy(asc(withdrawalDestinationAllocations.createdAt));
      return rows.map(toWithdrawalDestinationAllocation);
    },
    /**
     * Every leg row of one save shares the identical `idempotencyKey`
     * (schema.ts) -- so a single row is enough to tell whether the existing
     * set, if any, belongs to this exact request (`recordDestinationAllocation`'s
     * own doc comment explains why this non-atomic pre-check exists
     * alongside `recordAllocation`'s atomic one).
     */
    async hasConflictingAllocation(withdrawalTransactionId, idempotencyKey) {
      const rows = await database
        .select({ idempotencyKey: withdrawalDestinationAllocations.idempotencyKey })
        .from(withdrawalDestinationAllocations)
        .where(eq(withdrawalDestinationAllocations.withdrawalTransactionId, withdrawalTransactionId))
        .limit(1);
      const existing = rows[0];
      return existing !== undefined && existing.idempotencyKey !== idempotencyKey;
    },
    /** Story 4.10 (FR30) -- mirrors `createInvestmentTransactionPort.findById`'s identical plain-select shape one ledger over. */
    async findById(id) {
      const rows = await database
        .select()
        .from(withdrawalDestinationAllocations)
        .where(eq(withdrawalDestinationAllocations.id, id))
        .limit(1);
      const row = rows[0];
      return row ? toWithdrawalDestinationAllocation(row) : null;
    },
    /** Story 5.1 (FR31) -- mirrors `createInvestmentTransactionPort.listAll`'s identical shape. */
    async listAll() {
      const rows = await database.select().from(withdrawalDestinationAllocations);
      return rows.map(toWithdrawalDestinationAllocation);
    },
  };
}

/**
 * Drizzle-backed implementation of `packages/core`'s `MoneyMovementPort`
 * (Story 4.8, FR28, AD-6). `record` is a plain single-row insert -- no paired
 * `audit_log` row of its own (`MoneyMovementPort.record`'s own doc comment
 * explains why), and no idempotency handling of its own either: its single
 * call site (`createWithdrawalDestinationAllocationPort.recordAllocation`,
 * via `moveWithdrawalToProject()`) is only ever reached once per "project"
 * leg, even under a concurrent double-submit race, because that port's own
 * `SELECT ... FOR UPDATE` lock on the parent `withdrawal_transactions` row
 * fully serializes every concurrent allocation attempt for the same
 * withdrawal before any of this ever runs.
 */
export function createMoneyMovementPort(database: Database = getDb()): MoneyMovementPort {
  return {
    async record(input) {
      const [row] = await database
        .insert(moneyMovements)
        .values({
          id: uuidv7(),
          withdrawalDestinationAllocationId: input.withdrawalDestinationAllocationId ?? null,
          availableBalanceSpendId: input.availableBalanceSpendId ?? null,
          sourceProjectId: input.sourceProjectId,
          destinationProjectId: input.destinationProjectId,
          destinationInvestmentTransactionId: input.destinationInvestmentTransactionId,
          amount: input.amount,
        })
        .returning();
      if (!row) {
        throw new Error("Failed to record money movement");
      }
      return toMoneyMovement(row);
    },
    async listByDestinationProjectId(projectId) {
      const rows = await database
        .select()
        .from(moneyMovements)
        .where(eq(moneyMovements.destinationProjectId, projectId))
        .orderBy(asc(moneyMovements.createdAt));
      return rows.map(toMoneyMovement);
    },
    /** Story 4.10 (FR30) -- at most one row by construction (this port's own doc comment). */
    async findByDestinationInvestmentTransactionId(investmentTransactionId) {
      const rows = await database
        .select()
        .from(moneyMovements)
        .where(eq(moneyMovements.destinationInvestmentTransactionId, investmentTransactionId))
        .limit(1);
      const row = rows[0];
      return row ? toMoneyMovement(row) : null;
    },
    /** Story 4.10 (FR30) -- at most one row by construction (this port's own doc comment). */
    async findByWithdrawalDestinationAllocationId(allocationId) {
      const rows = await database
        .select()
        .from(moneyMovements)
        .where(eq(moneyMovements.withdrawalDestinationAllocationId, allocationId))
        .limit(1);
      const row = rows[0];
      return row ? toMoneyMovement(row) : null;
    },
    /** Story 4.10 (FR30) -- at most one row by construction (this port's own doc comment). */
    async findByAvailableBalanceSpendId(spendId) {
      const rows = await database
        .select()
        .from(moneyMovements)
        .where(eq(moneyMovements.availableBalanceSpendId, spendId))
        .limit(1);
      const row = rows[0];
      return row ? toMoneyMovement(row) : null;
    },
    /** Story 5.1 (FR31) -- mirrors `createInvestmentTransactionPort.listAll`'s identical shape. */
    async listAll() {
      const rows = await database.select().from(moneyMovements);
      return rows.map(toMoneyMovement);
    },
  };
}

/**
 * Drizzle-backed implementation of `packages/core`'s `AvailableBalancePort`
 * (Story 4.9, FR29, AD-10) -- the running Available Balance ledger.
 *
 * `creditBalance` is an atomic upsert (`INSERT ... ON CONFLICT (party_type,
 * share_id, project_id) DO UPDATE SET balance = available_balances.balance +
 * excluded.balance`) -- no explicit row lock needed, Postgres's own
 * `ON CONFLICT` handling is atomic against concurrent writers on its own
 * (this story's Decisions #7).
 *
 * `debitBalance` always runs inside its own `database.transaction(...)` call
 * -- when `database` is already a caller-supplied transaction handle (e.g.
 * `createAvailableBalanceSpendPort.recordSpend` constructing
 * `createAvailableBalancePort(tx)`), this becomes a nested transaction
 * (a savepoint), mirroring `createInvestmentTransactionPort.recordTransaction`'s
 * identical `database.transaction(...)`-inside-a-`tx` precedent (see that
 * method's own call from `moveWithdrawalToProject()`, itself called from
 * inside `createWithdrawalDestinationAllocationPort.recordAllocation`'s own
 * open transaction) -- this codebase's established transaction-binding
 * pattern one level deeper. Sequence: `SELECT ... FOR UPDATE` on the
 * matching `(partyType, shareId, projectId)` row (AD-10) -- a missing row is
 * treated as a `"0"` balance -- then `assertSufficientBalance` (throws
 * `InsufficientAvailableBalanceError`, rolling back this transaction/
 * savepoint, writing nothing, if insufficient) -- then `UPDATE balance =
 * subtractMoney(current, amount)` (or, in the degenerate no-existing-row-yet
 * case, an insert of a fresh `"0"` row -- only reachable when `amount` is
 * itself `"0"`, since `assertSufficientBalance` would otherwise have already
 * thrown against a `"0"` current balance). The row lock is held for the
 * whole check-then-write sequence, so two concurrent debits against the same
 * balance are fully serialized by Postgres's own row-lock blocking (AD-10,
 * AC4): the second to acquire the lock re-reads the first's already-applied
 * debit (`READ COMMITTED`'s standard `SELECT ... FOR UPDATE` re-read-on-
 * unblock behavior), never a stale pre-debit balance -- never a lost update,
 * never negative.
 */
export function createAvailableBalancePort(database: Database = getDb()): AvailableBalancePort {
  return {
    async creditBalance(input) {
      const [row] = await database
        .insert(availableBalances)
        .values({
          id: uuidv7(),
          projectId: input.projectId,
          partyType: input.partyType,
          shareId: input.shareId,
          balance: input.amount,
        })
        .onConflictDoUpdate({
          target: [availableBalances.partyType, availableBalances.shareId, availableBalances.projectId],
          set: {
            balance: sql`${availableBalances.balance} + ${input.amount}`,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!row) {
        throw new Error("Failed to credit available balance");
      }
      return toAvailableBalance(row);
    },
    async debitBalance(input) {
      return database.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(availableBalances)
          .where(
            and(
              eq(availableBalances.partyType, input.partyType),
              eq(availableBalances.shareId, input.shareId),
              eq(availableBalances.projectId, input.projectId),
            ),
          )
          .for("update");
        const existingRow = existing[0] ?? null;
        const currentBalance = (existingRow?.balance ?? "0") as Money;

        assertSufficientBalance(currentBalance, input.amount);

        const newBalance = subtractMoney(currentBalance, input.amount);

        if (!existingRow) {
          const [row] = await tx
            .insert(availableBalances)
            .values({
              id: uuidv7(),
              projectId: input.projectId,
              partyType: input.partyType,
              shareId: input.shareId,
              balance: newBalance,
            })
            .returning();
          if (!row) {
            throw new Error("Failed to debit available balance");
          }
          return toAvailableBalance(row);
        }

        const [row] = await tx
          .update(availableBalances)
          .set({ balance: newBalance, updatedAt: new Date() })
          .where(eq(availableBalances.id, existingRow.id))
          .returning();
        if (!row) {
          throw new Error("Failed to debit available balance");
        }
        return toAvailableBalance(row);
      });
    },
    async listBalancesByProjectId(projectId) {
      const rows = await database.select().from(availableBalances).where(eq(availableBalances.projectId, projectId));
      return rows.map(toAvailableBalance);
    },
    /** Story 4.10 (FR30) -- plain read, no row lock (unlike `debitBalance`'s own `SELECT ... FOR UPDATE`; this port method's own doc comment). */
    async findBalance(partyType, shareId, projectId) {
      const rows = await database
        .select()
        .from(availableBalances)
        .where(
          and(
            eq(availableBalances.partyType, partyType),
            eq(availableBalances.shareId, shareId),
            eq(availableBalances.projectId, projectId),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row ? toAvailableBalance(row) : null;
    },
    /** Story 5.4 -- plain, unfiltered read, mirrors every other port's identical `listAll()` shape (e.g. `createInvestmentTransactionPort.listAll`). */
    async listAll() {
      const rows = await database.select().from(availableBalances);
      return rows.map(toAvailableBalance);
    },
  };
}

/**
 * `true` if `existing` (an `available_balance_spends` row found by
 * `idempotencyKey`) represents the exact same request as `input` -- mirrors
 * `matchesWithdrawalRequest`'s identical rounding-safety/field-comparison
 * rationale one ledger over. `?? null` on both sides of every nullable field
 * mirrors `matchesAllocationRequest`'s identical convention.
 */
export function matchesAvailableBalanceSpendRequest(
  existing: AvailableBalanceSpend,
  input: RecordAvailableBalanceSpendInput,
): boolean {
  return (
    existing.sourceProjectId === input.sourceProjectId &&
    existing.partyType === input.partyType &&
    existing.shareId === input.shareId &&
    existing.destinationType === input.destinationType &&
    moneyEquals(existing.amount, input.amount) &&
    (existing.destinationProjectId ?? null) === (input.destinationProjectId ?? null) &&
    (existing.destinationRequirementId ?? null) === (input.destinationRequirementId ?? null) &&
    (existing.destinationShareId ?? null) === (input.destinationShareId ?? null) &&
    (existing.destinationPartyType ?? null) === (input.destinationPartyType ?? null) &&
    (existing.personName ?? null) === (input.personName ?? null) &&
    (existing.notes ?? null) === (input.notes ?? null)
  );
}

/**
 * Drizzle-backed implementation of `packages/core`'s `AvailableBalanceSpendPort`
 * (Story 4.9, FR29, AD-5/AD-6/AD-10) -- mirrors
 * `createWithdrawalTransactionPort.recordTransaction`'s exact
 * check-first-then-transact idempotency structure one ledger over
 * (`available_balance_spends.idempotencyKey` is table-wide UNIQUE, unlike
 * `withdrawal_destination_allocations`' deliberately-non-unique column, so
 * there IS a UNIQUE-constraint-violation signal a concurrent double-submit
 * can race against and recover from, unlike that port's own
 * lock-the-parent-row shape), extended with an `AvailableBalancePort.debitBalance`
 * call (AD-10's row lock) and, for a `"project"` spend,
 * `spendAvailableBalanceToProject()` (AD-6), all inside the one
 * `database.transaction()` this method opens.
 */
export function createAvailableBalanceSpendPort(
  database: Database = getDb(),
): AvailableBalanceSpendPort {
  async function findSpendByIdempotencyKey(idempotencyKey: string): Promise<AvailableBalanceSpend | null> {
    const rows = await database
      .select()
      .from(availableBalanceSpends)
      .where(eq(availableBalanceSpends.idempotencyKey, idempotencyKey))
      .limit(1);
    const row = rows[0];
    return row ? toAvailableBalanceSpend(row) : null;
  }

  /** The linked `money_movements`/`investment_transactions` rows for an already-saved `"project"` spend, if any -- read back (never re-created) on a replay, mirroring `recordAllocation`'s identical replay-reads-back-the-linked-movement precedent. */
  async function findLinkedMovementAndTransaction(
    spendId: string,
  ): Promise<{ moneyMovement: MoneyMovement | null; investmentTransaction: InvestmentTransaction | null }> {
    const movementRows = await database
      .select()
      .from(moneyMovements)
      .where(eq(moneyMovements.availableBalanceSpendId, spendId))
      .limit(1);
    const movementRow = movementRows[0];
    if (!movementRow) {
      return { moneyMovement: null, investmentTransaction: null };
    }
    const transactionRows = await database
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.id, movementRow.destinationInvestmentTransactionId))
      .limit(1);
    const transactionRow = transactionRows[0];
    return {
      moneyMovement: toMoneyMovement(movementRow),
      investmentTransaction: transactionRow ? toInvestmentTransaction(transactionRow) : null,
    };
  }

  return {
    async recordSpend(input, idempotencyKey, actorUserId) {
      const existing = await findSpendByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (!matchesAvailableBalanceSpendRequest(existing, input)) {
          throw new AvailableBalanceSpendIdempotencyKeyConflictError();
        }
        const linked = await findLinkedMovementAndTransaction(existing.id);
        return { spend: existing, ...linked, created: false };
      }

      try {
        const result = await database.transaction(async (tx) => {
          const availableBalancePort = createAvailableBalancePort(tx);
          await availableBalancePort.debitBalance({
            projectId: input.sourceProjectId,
            partyType: input.partyType,
            shareId: input.shareId,
            amount: input.amount,
          });

          const spendId = uuidv7();
          const [spendRow] = await tx
            .insert(availableBalanceSpends)
            .values({
              id: spendId,
              sourceProjectId: input.sourceProjectId,
              partyType: input.partyType,
              shareId: input.shareId,
              destinationType: input.destinationType,
              destinationProjectId: input.destinationProjectId,
              destinationRequirementId: input.destinationRequirementId,
              destinationShareId: input.destinationShareId,
              destinationPartyType: input.destinationPartyType,
              personName: input.personName,
              amount: input.amount,
              notes: input.notes,
              idempotencyKey,
              actorUserId,
            })
            .returning();
          if (!spendRow) {
            throw new Error("Failed to record available balance spend");
          }

          let investmentTransaction: InvestmentTransaction | null = null;
          let moneyMovement: MoneyMovement | null = null;
          if (input.destinationType === "project") {
            if (
              !input.destinationProjectId ||
              !input.destinationRequirementId ||
              !input.destinationShareId ||
              !input.destinationPartyType ||
              !input.destinationSnapshotInput
            ) {
              throw new Error(
                "Failed to spend available balance to project: no resolved destination snapshot",
              );
            }
            const investmentTransactionPort = createInvestmentTransactionPort(tx);
            const moneyMovementPort = createMoneyMovementPort(tx);
            const spendResult = await spendAvailableBalanceToProject(
              spendId,
              input.sourceProjectId,
              input.destinationProjectId,
              input.destinationSnapshotInput.requirement,
              input.destinationSnapshotInput.partnerShares,
              input.destinationSnapshotInput.subPartnerSharesByPartnerId,
              input.destinationPartyType,
              input.destinationShareId,
              input.amount,
              `${idempotencyKey}:spend`,
              actorUserId,
              { investmentTransactions: investmentTransactionPort, moneyMovements: moneyMovementPort },
            );
            investmentTransaction = spendResult.investmentTransaction;
            moneyMovement = spendResult.moneyMovement;
          }

          await tx.insert(auditLog).values({
            id: uuidv7(),
            entityType: "available_balance_spend",
            entityId: spendId,
            action: "create",
            actorUserId,
            oldValue: null,
            newValue: spendRow,
            reason: null,
          });

          return {
            spend: toAvailableBalanceSpend(spendRow),
            investmentTransaction,
            moneyMovement,
            created: true as const,
          };
        });
        return result;
      } catch (error) {
        if (error instanceof InsufficientAvailableBalanceError) {
          throw error;
        }
        if (isUniqueViolation(error)) {
          const winner = await findSpendByIdempotencyKey(idempotencyKey);
          if (winner) {
            if (!matchesAvailableBalanceSpendRequest(winner, input)) {
              throw new AvailableBalanceSpendIdempotencyKeyConflictError();
            }
            const linked = await findLinkedMovementAndTransaction(winner.id);
            return { spend: winner, ...linked, created: false };
          }
        }
        throw error;
      }
    },
    /** Story 4.10 (FR30) -- mirrors `createInvestmentTransactionPort.findById`'s identical plain-select shape one ledger over. */
    async findById(id) {
      const rows = await database
        .select()
        .from(availableBalanceSpends)
        .where(eq(availableBalanceSpends.id, id))
        .limit(1);
      const row = rows[0];
      return row ? toAvailableBalanceSpend(row) : null;
    },
    /** Story 5.1 (FR31) -- mirrors `createInvestmentTransactionPort.listAll`'s identical shape. */
    async listAll() {
      const rows = await database.select().from(availableBalanceSpends);
      return rows.map(toAvailableBalanceSpend);
    },
  };
}

/**
 * `true` if `existing` (an `adjustment_nettings` row found by
 * `idempotencyKey`) actually represents the *same* logical netting request
 * as `input` -- mirrors `matchesAvailableBalanceSpendRequest`'s exact
 * rationale one financial-write table over. `amount` is compared via
 * `moneyEquals` (decimal-value-aware), never `===` -- `existing.amount` came
 * back from Postgres's `numeric(14,2)` column, which round-trips a stored
 * value at its full declared scale, while `input.amount` is the
 * freshly-submitted, unreformatted value.
 */
export function matchesAdjustmentNettingRequest(
  existing: AdjustmentNetting,
  input: RecordAdjustmentNettingInput,
): boolean {
  return (
    existing.projectId === input.projectId &&
    existing.partyType === input.partyType &&
    existing.shareId === input.shareId &&
    existing.investmentRequirementId === input.investmentRequirementId &&
    moneyEquals(existing.amount, input.amount) &&
    (existing.notes ?? null) === (input.notes ?? null)
  );
}

/**
 * Drizzle-backed implementation of `packages/core`'s `AdjustmentNettingPort`
 * (Story 5.3, FR33/FR34, AD-4/AD-5) -- mirrors
 * `createAvailableBalanceSpendPort.recordSpend`'s exact
 * check-first-then-transact idempotency structure (`idempotencyKey`/
 * `actorUserId` are separate parameters, not fields on `input`), simpler
 * since a netting write never touches a second ledger table -- it is a
 * single-row insert plus its paired `audit_log` row, nothing else (AD-4:
 * `investment_adjustments`/`withdrawal_adjustments` are never read-to-
 * compute-or-offset here, and never written to by this port).
 *
 * `recordNetting`'s idempotency handling, in order (mirrors
 * `createWithdrawalTransactionPort.recordTransaction`'s identical shape):
 * 1. `SELECT` by `idempotencyKey` first -- if a row already exists AND it
 *    `matchesAdjustmentNettingRequest` the current `input`, return it
 *    immediately (`created: false`), no transaction attempted at all. If a
 *    row exists but does NOT match, this is a genuine key collision between
 *    two unrelated requests -- throw `AdjustmentNettingIdempotencyKeyConflictError`.
 * 2. Otherwise (no existing row), insert the netting row and its paired
 *    `audit_log` row together inside one `database.transaction()` call
 *    (`created: true`).
 * 3. If that insert throws because of the `idempotency_key` UNIQUE
 *    constraint (SQL state `23505`) -- a concurrent double-submit that raced
 *    step 1 -- catch it, re-`SELECT` by `idempotencyKey`, and apply the same
 *    `matchesAdjustmentNettingRequest` check to the winning row: match ->
 *    return it (`created: false`) instead of propagating the error;
 *    mismatch -> `AdjustmentNettingIdempotencyKeyConflictError`. Any other
 *    error still propagates unchanged.
 */
export function createAdjustmentNettingPort(database: Database = getDb()): AdjustmentNettingPort {
  async function findByIdempotencyKey(idempotencyKey: string): Promise<AdjustmentNetting | null> {
    const rows = await database
      .select()
      .from(adjustmentNettings)
      .where(eq(adjustmentNettings.idempotencyKey, idempotencyKey))
      .limit(1);
    const row = rows[0];
    return row ? toAdjustmentNetting(row) : null;
  }

  return {
    async recordNetting(input, idempotencyKey, actorUserId) {
      const existing = await findByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (!matchesAdjustmentNettingRequest(existing, input)) {
          throw new AdjustmentNettingIdempotencyKeyConflictError();
        }
        return { netting: existing, created: false };
      }

      try {
        const inserted = await database.transaction(async (tx) => {
          const [row] = await tx
            .insert(adjustmentNettings)
            .values({
              id: uuidv7(),
              projectId: input.projectId,
              partyType: input.partyType,
              shareId: input.shareId,
              investmentRequirementId: input.investmentRequirementId,
              amount: input.amount,
              notes: input.notes,
              idempotencyKey,
              actorUserId,
            })
            .returning();
          if (!row) {
            throw new Error("Failed to record adjustment netting");
          }

          await tx.insert(auditLog).values({
            id: uuidv7(),
            entityType: "adjustment_netting",
            entityId: row.id,
            action: "create",
            actorUserId,
            oldValue: null,
            newValue: row,
            reason: null,
          });

          return row;
        });

        return { netting: toAdjustmentNetting(inserted), created: true };
      } catch (error) {
        if (isUniqueViolation(error)) {
          const winner = await findByIdempotencyKey(idempotencyKey);
          if (winner) {
            if (!matchesAdjustmentNettingRequest(winner, input)) {
              throw new AdjustmentNettingIdempotencyKeyConflictError();
            }
            return { netting: winner, created: false };
          }
        }
        throw error;
      }
    },
    async listAll() {
      const rows = await database.select().from(adjustmentNettings);
      return rows.map(toAdjustmentNetting);
    },
  };
}
