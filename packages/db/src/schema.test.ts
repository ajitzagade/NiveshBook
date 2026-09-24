import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  users,
  projects,
  partnerShares,
  subpartnerShares,
  investmentRequirements,
  investmentTransactions,
  investmentAdjustments,
  recommendedAmounts,
  auditLog,
} from "./schema";

describe("users table schema (FR6)", () => {
  it("marks role NOT NULL — the DB itself rejects a null/missing role", () => {
    expect(users.role.notNull).toBe(true);
  });

  it("gives role no implicit default — every insert must supply one explicitly", () => {
    expect(users.role.hasDefault).toBe(false);
  });
});

describe("projects table schema (Story 2.1)", () => {
  it("marks name NOT NULL — a project must always have a name", () => {
    expect(projects.name.notNull).toBe(true);
  });

  it("leaves description nullable — a project can exist with none", () => {
    expect(projects.description.notNull).toBe(false);
  });

  it("gives id no implicit default — application code (uuidv7) always supplies one", () => {
    expect(projects.id.hasDefault).toBe(false);
  });

  it("marks createdAt/updatedAt NOT NULL with a DB-side default", () => {
    expect(projects.createdAt.notNull).toBe(true);
    expect(projects.createdAt.hasDefault).toBe(true);
    expect(projects.updatedAt.notNull).toBe(true);
    expect(projects.updatedAt.hasDefault).toBe(true);
  });
});

describe("partner_shares table schema (Story 2.2)", () => {
  it("marks partnerId/projectId/name/sharePercent NOT NULL", () => {
    expect(partnerShares.partnerId.notNull).toBe(true);
    expect(partnerShares.projectId.notNull).toBe(true);
    expect(partnerShares.name.notNull).toBe(true);
    expect(partnerShares.sharePercent.notNull).toBe(true);
  });

  it("gives id no implicit default -- application code (uuidv7) always supplies one, both for the first version and every later one", () => {
    expect(partnerShares.id.hasDefault).toBe(false);
  });

  it("gives partnerId no implicit default -- the domain layer generates it once and reuses it across every version row", () => {
    expect(partnerShares.partnerId.hasDefault).toBe(false);
  });

  it("stores sharePercent as numeric(7,4) -- up to 4 decimal places, no float storage (AD-2)", () => {
    expect(partnerShares.sharePercent.columnType).toBe("PgNumeric");
    expect(partnerShares.sharePercent.getSQLType()).toBe("numeric(7, 4)");
  });

  it("marks effectiveFrom/createdAt NOT NULL with a DB-side default", () => {
    expect(partnerShares.effectiveFrom.notNull).toBe(true);
    expect(partnerShares.effectiveFrom.hasDefault).toBe(true);
    expect(partnerShares.createdAt.notNull).toBe(true);
    expect(partnerShares.createdAt.hasDefault).toBe(true);
  });

  it("leaves userId nullable -- Story 2.4's User<->Partner link is optional", () => {
    expect(partnerShares.userId.notNull).toBe(false);
  });

  it("gives userId no implicit default", () => {
    expect(partnerShares.userId.hasDefault).toBe(false);
  });

  it("marks subPartnerVisibilityGrant NOT NULL with a false DB-side default (Story 2.6)", () => {
    expect(partnerShares.subPartnerVisibilityGrant.notNull).toBe(true);
    expect(partnerShares.subPartnerVisibilityGrant.hasDefault).toBe(true);
    expect(partnerShares.subPartnerVisibilityGrant.columnType).toBe("PgBoolean");
  });
});

describe("subpartner_shares table schema (Story 2.3)", () => {
  it("marks subPartnerId/partnerId/projectId/name/sharePercent NOT NULL", () => {
    expect(subpartnerShares.subPartnerId.notNull).toBe(true);
    expect(subpartnerShares.partnerId.notNull).toBe(true);
    expect(subpartnerShares.projectId.notNull).toBe(true);
    expect(subpartnerShares.name.notNull).toBe(true);
    expect(subpartnerShares.sharePercent.notNull).toBe(true);
  });

  it("gives id no implicit default -- application code (uuidv7) always supplies one, both for the first version and every later one", () => {
    expect(subpartnerShares.id.hasDefault).toBe(false);
  });

  it("gives subPartnerId no implicit default -- the domain layer generates it once and reuses it across every version row", () => {
    expect(subpartnerShares.subPartnerId.hasDefault).toBe(false);
  });

  it("stores sharePercent as numeric(7,4) -- up to 4 decimal places, no float storage (AD-2)", () => {
    expect(subpartnerShares.sharePercent.columnType).toBe("PgNumeric");
    expect(subpartnerShares.sharePercent.getSQLType()).toBe("numeric(7, 4)");
  });

  it("marks effectiveFrom/createdAt NOT NULL with a DB-side default", () => {
    expect(subpartnerShares.effectiveFrom.notNull).toBe(true);
    expect(subpartnerShares.effectiveFrom.hasDefault).toBe(true);
    expect(subpartnerShares.createdAt.notNull).toBe(true);
    expect(subpartnerShares.createdAt.hasDefault).toBe(true);
  });

  it("leaves userId nullable -- Story 2.4's User<->Sub-partner link is optional", () => {
    expect(subpartnerShares.userId.notNull).toBe(false);
  });

  it("gives userId no implicit default", () => {
    expect(subpartnerShares.userId.hasDefault).toBe(false);
  });
});

describe("investment_requirements table schema (Story 3.1)", () => {
  it("marks projectId/amount/requirementDate NOT NULL", () => {
    expect(investmentRequirements.projectId.notNull).toBe(true);
    expect(investmentRequirements.amount.notNull).toBe(true);
    expect(investmentRequirements.requirementDate.notNull).toBe(true);
  });

  it("gives id no implicit default -- application code (uuidv7) always supplies one", () => {
    expect(investmentRequirements.id.hasDefault).toBe(false);
  });

  it("stores amount as numeric(14,2) -- up to 2 decimal places, no float storage (AD-2)", () => {
    expect(investmentRequirements.amount.columnType).toBe("PgNumeric");
    expect(investmentRequirements.amount.getSQLType()).toBe("numeric(14, 2)");
  });

  it("stores requirementDate as a plain date column (no time component)", () => {
    expect(investmentRequirements.requirementDate.columnType).toBe("PgDateString");
    expect(investmentRequirements.requirementDate.getSQLType()).toBe("date");
  });

  it("marks createdAt NOT NULL with a DB-side default", () => {
    expect(investmentRequirements.createdAt.notNull).toBe(true);
    expect(investmentRequirements.createdAt.hasDefault).toBe(true);
  });
});

describe("investment_transactions table schema (Story 3.3)", () => {
  it("marks requirementId/projectId/partyType/shareId/sharePercentSnapshot/shouldPaySnapshot/amount/transactionDate/paymentMode/idempotencyKey NOT NULL", () => {
    expect(investmentTransactions.requirementId.notNull).toBe(true);
    expect(investmentTransactions.projectId.notNull).toBe(true);
    expect(investmentTransactions.partyType.notNull).toBe(true);
    expect(investmentTransactions.shareId.notNull).toBe(true);
    expect(investmentTransactions.sharePercentSnapshot.notNull).toBe(true);
    expect(investmentTransactions.shouldPaySnapshot.notNull).toBe(true);
    expect(investmentTransactions.amount.notNull).toBe(true);
    expect(investmentTransactions.transactionDate.notNull).toBe(true);
    expect(investmentTransactions.paymentMode.notNull).toBe(true);
    expect(investmentTransactions.idempotencyKey.notNull).toBe(true);
  });

  it("gives id no implicit default -- application code (uuidv7) always supplies one", () => {
    expect(investmentTransactions.id.hasDefault).toBe(false);
  });

  it("leaves referenceNumber/notes nullable -- both optional (this story's Decisions)", () => {
    expect(investmentTransactions.referenceNumber.notNull).toBe(false);
    expect(investmentTransactions.notes.notNull).toBe(false);
  });

  it("stores sharePercentSnapshot as numeric(7,4), mirroring partner_shares.sharePercent's precision", () => {
    expect(investmentTransactions.sharePercentSnapshot.columnType).toBe("PgNumeric");
    expect(investmentTransactions.sharePercentSnapshot.getSQLType()).toBe("numeric(7, 4)");
  });

  it("stores shouldPaySnapshot/amount as numeric(14,2), mirroring investment_requirements.amount's precision", () => {
    expect(investmentTransactions.shouldPaySnapshot.columnType).toBe("PgNumeric");
    expect(investmentTransactions.shouldPaySnapshot.getSQLType()).toBe("numeric(14, 2)");
    expect(investmentTransactions.amount.columnType).toBe("PgNumeric");
    expect(investmentTransactions.amount.getSQLType()).toBe("numeric(14, 2)");
  });

  it("stores transactionDate as a plain date column (no time component)", () => {
    expect(investmentTransactions.transactionDate.columnType).toBe("PgDateString");
    expect(investmentTransactions.transactionDate.getSQLType()).toBe("date");
  });

  it("stores shareId as uuid with no FK reference -- neither partner_shares.partnerId nor subpartner_shares.subPartnerId has a uniqueness constraint to reference (this story's Decisions)", () => {
    expect(investmentTransactions.shareId.columnType).toBe("PgUUID");
  });

  it("enforces idempotencyKey UNIQUE at the DB level -- the actual double-submit protection, not just an application-layer check", () => {
    expect(investmentTransactions.idempotencyKey.isUnique).toBe(true);
  });

  it("marks createdAt NOT NULL with a DB-side default", () => {
    expect(investmentTransactions.createdAt.notNull).toBe(true);
    expect(investmentTransactions.createdAt.hasDefault).toBe(true);
  });
});

describe("investment_adjustments table schema (Story 3.4)", () => {
  it("marks projectId/partyType/shareId/requirementId/shouldPay/actualPaid/adjustmentAmount/adjustmentType NOT NULL", () => {
    expect(investmentAdjustments.projectId.notNull).toBe(true);
    expect(investmentAdjustments.partyType.notNull).toBe(true);
    expect(investmentAdjustments.shareId.notNull).toBe(true);
    expect(investmentAdjustments.requirementId.notNull).toBe(true);
    expect(investmentAdjustments.shouldPay.notNull).toBe(true);
    expect(investmentAdjustments.actualPaid.notNull).toBe(true);
    expect(investmentAdjustments.adjustmentAmount.notNull).toBe(true);
    expect(investmentAdjustments.adjustmentType.notNull).toBe(true);
  });

  it("gives id no implicit default -- application code (uuidv7) always supplies one", () => {
    expect(investmentAdjustments.id.hasDefault).toBe(false);
  });

  it("stores shouldPay/actualPaid/adjustmentAmount as numeric(14,2), mirroring investment_requirements.amount's precision", () => {
    expect(investmentAdjustments.shouldPay.columnType).toBe("PgNumeric");
    expect(investmentAdjustments.shouldPay.getSQLType()).toBe("numeric(14, 2)");
    expect(investmentAdjustments.actualPaid.columnType).toBe("PgNumeric");
    expect(investmentAdjustments.actualPaid.getSQLType()).toBe("numeric(14, 2)");
    expect(investmentAdjustments.adjustmentAmount.columnType).toBe("PgNumeric");
    expect(investmentAdjustments.adjustmentAmount.getSQLType()).toBe("numeric(14, 2)");
  });

  it("stores shareId as uuid with no FK reference -- mirrors investment_transactions.shareId's precedent (this story's Code Map)", () => {
    expect(investmentAdjustments.shareId.columnType).toBe("PgUUID");
  });

  it("enforces a composite UNIQUE constraint on (partyType, shareId, projectId) -- the single-row-per-person guarantee (this story's Boundaries), not just an application-layer check", () => {
    const { uniqueConstraints } = getTableConfig(investmentAdjustments);
    expect(uniqueConstraints).toHaveLength(1);
    const constraint = uniqueConstraints[0];
    expect(constraint?.columns.map((column) => column.name)).toEqual([
      "party_type",
      "share_id",
      "project_id",
    ]);
  });

  it("marks updatedAt/createdAt NOT NULL with a DB-side default", () => {
    expect(investmentAdjustments.updatedAt.notNull).toBe(true);
    expect(investmentAdjustments.updatedAt.hasDefault).toBe(true);
    expect(investmentAdjustments.createdAt.notNull).toBe(true);
    expect(investmentAdjustments.createdAt.hasDefault).toBe(true);
  });
});

describe("recommended_amounts table schema (Story 3.5)", () => {
  it("marks requirementId/projectId/partyType/shareId/baseAmount/previousPending/previousExtraPaid/recommendedAmount NOT NULL", () => {
    expect(recommendedAmounts.requirementId.notNull).toBe(true);
    expect(recommendedAmounts.projectId.notNull).toBe(true);
    expect(recommendedAmounts.partyType.notNull).toBe(true);
    expect(recommendedAmounts.shareId.notNull).toBe(true);
    expect(recommendedAmounts.baseAmount.notNull).toBe(true);
    expect(recommendedAmounts.previousPending.notNull).toBe(true);
    expect(recommendedAmounts.previousExtraPaid.notNull).toBe(true);
    expect(recommendedAmounts.recommendedAmount.notNull).toBe(true);
  });

  it("gives id no implicit default -- application code (uuidv7) always supplies one", () => {
    expect(recommendedAmounts.id.hasDefault).toBe(false);
  });

  it("stores baseAmount/previousPending/previousExtraPaid/recommendedAmount as numeric(14,2), mirroring investment_requirements.amount's precision", () => {
    expect(recommendedAmounts.baseAmount.columnType).toBe("PgNumeric");
    expect(recommendedAmounts.baseAmount.getSQLType()).toBe("numeric(14, 2)");
    expect(recommendedAmounts.previousPending.columnType).toBe("PgNumeric");
    expect(recommendedAmounts.previousPending.getSQLType()).toBe("numeric(14, 2)");
    expect(recommendedAmounts.previousExtraPaid.columnType).toBe("PgNumeric");
    expect(recommendedAmounts.previousExtraPaid.getSQLType()).toBe("numeric(14, 2)");
    expect(recommendedAmounts.recommendedAmount.columnType).toBe("PgNumeric");
    expect(recommendedAmounts.recommendedAmount.getSQLType()).toBe("numeric(14, 2)");
  });

  it("stores shareId as uuid with no FK reference -- mirrors investment_adjustments.shareId's precedent (this story's Code Map)", () => {
    expect(recommendedAmounts.shareId.columnType).toBe("PgUUID");
  });

  it("enforces a composite UNIQUE constraint on (requirementId, partyType, shareId) -- a data-integrity guard against a double-snapshot, not an upsert-conflict target (this story's Decisions: snapshot is always a plain insert)", () => {
    const { uniqueConstraints } = getTableConfig(recommendedAmounts);
    expect(uniqueConstraints).toHaveLength(1);
    const constraint = uniqueConstraints[0];
    expect(constraint?.columns.map((column) => column.name)).toEqual([
      "requirement_id",
      "party_type",
      "share_id",
    ]);
  });

  it("marks createdAt NOT NULL with a DB-side default", () => {
    expect(recommendedAmounts.createdAt.notNull).toBe(true);
    expect(recommendedAmounts.createdAt.hasDefault).toBe(true);
  });
});

describe("audit_log table schema (Story 3.3, AD-5)", () => {
  it("marks entityType/entityId/action/actorUserId/newValue NOT NULL", () => {
    expect(auditLog.entityType.notNull).toBe(true);
    expect(auditLog.entityId.notNull).toBe(true);
    expect(auditLog.action.notNull).toBe(true);
    expect(auditLog.actorUserId.notNull).toBe(true);
    expect(auditLog.newValue.notNull).toBe(true);
  });

  it("leaves oldValue/reason nullable -- null for this story's create-only entries, populated by later edit/cancel stories", () => {
    expect(auditLog.oldValue.notNull).toBe(false);
    expect(auditLog.reason.notNull).toBe(false);
  });

  it("gives id no implicit default -- application code (uuidv7) always supplies one", () => {
    expect(auditLog.id.hasDefault).toBe(false);
  });

  it("stores oldValue/newValue as jsonb", () => {
    expect(auditLog.oldValue.columnType).toBe("PgJsonb");
    expect(auditLog.newValue.columnType).toBe("PgJsonb");
  });

  it("marks createdAt NOT NULL with a DB-side default", () => {
    expect(auditLog.createdAt.notNull).toBe(true);
    expect(auditLog.createdAt.hasDefault).toBe(true);
  });
});
