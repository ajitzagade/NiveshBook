import { and, desc, eq, gt } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type {
  UserPort,
  SessionPort,
  CreateSessionInput,
  ProjectPort,
  PartnerSharePort,
  SubPartnerSharePort,
} from "@niveshbook/core";
import type {
  User,
  Session,
  UserRole,
  Project,
  PartnerShare,
  SubPartnerShare,
  Percent,
} from "@niveshbook/types";
import type { Database } from "./client";
import { getDb } from "./client";
import {
  users,
  sessions,
  projects,
  partnerShares,
  subpartnerShares,
  type SessionRow,
  type UserRow,
  type ProjectRow,
  type PartnerShareRow,
  type SubPartnerShareRow,
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
  };
}
