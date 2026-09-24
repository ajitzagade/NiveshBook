import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import {
  AlreadyCancelledError,
  IdempotencyKeyConflictError,
  moneyEquals,
  WithdrawalIdempotencyKeyConflictError,
  AlreadyAllocatedError,
  WithdrawalDestinationAllocationIdempotencyKeyConflictError,
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
  type WithdrawalAdjustmentPort,
  type WithdrawalDestinationAllocationPort,
  type CreateWithdrawalDestinationAllocationLegInput,
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
  DestinationType,
  PaymentMode,
  Money,
  AuditLogEntry,
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
 * state `23505`), as surfaced by the `postgres` driver on the thrown error's
 * `.code`. A pure decision helper with no DB/Drizzle dependency of its own --
 * exported so `ports.test.ts` can unit-test it directly against a variety of
 * error shapes, without needing a live Postgres connection or a
 * Drizzle-transaction-mocking harness (this codebase has no precedent for
 * mocking Drizzle at that level).
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION_CODE
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
 * never spuriously mismatches a stored `null`.
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
        (row.notes ?? null) === (leg.notes ?? null),
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
 */
export function createWithdrawalDestinationAllocationPort(
  database: Database = getDb(),
): WithdrawalDestinationAllocationPort {
  return {
    async recordAllocation(withdrawalTransactionId, legs, idempotencyKey, actorUserId) {
      return database.transaction(async (tx) => {
        await tx
          .select({ id: withdrawalTransactions.id })
          .from(withdrawalTransactions)
          .where(eq(withdrawalTransactions.id, withdrawalTransactionId))
          .for("update");

        const existingRows = await tx
          .select()
          .from(withdrawalDestinationAllocations)
          .where(eq(withdrawalDestinationAllocations.withdrawalTransactionId, withdrawalTransactionId));

        if (existingRows.length > 0) {
          const sameKey = existingRows.every((row) => row.idempotencyKey === idempotencyKey);
          if (sameKey && matchesAllocationRequest(existingRows, legs)) {
            return { allocations: existingRows.map(toWithdrawalDestinationAllocation), created: false };
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

        const insertedRows = await tx
          .insert(withdrawalDestinationAllocations)
          .values(
            legs.map((leg) => ({
              id: uuidv7(),
              withdrawalTransactionId,
              destinationType: leg.destinationType,
              amount: leg.amount,
              destinationProjectId: leg.destinationProjectId,
              personName: leg.personName,
              notes: leg.notes,
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

        return { allocations: insertedRows.map(toWithdrawalDestinationAllocation), created: true };
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
  };
}
