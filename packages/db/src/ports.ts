import { and, asc, desc, eq, gt } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import {
  IdempotencyKeyConflictError,
  moneyEquals,
  type UserPort,
  type SessionPort,
  type CreateSessionInput,
  type ProjectPort,
  type PartnerSharePort,
  type SubPartnerSharePort,
  type InvestmentRequirementPort,
  type InvestmentTransactionPort,
  type CreateInvestmentTransactionInput,
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
  PaymentMode,
  Money,
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
  auditLog,
  type SessionRow,
  type UserRow,
  type ProjectRow,
  type PartnerShareRow,
  type SubPartnerShareRow,
  type InvestmentRequirementRow,
  type InvestmentTransactionRow,
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
  };
}
