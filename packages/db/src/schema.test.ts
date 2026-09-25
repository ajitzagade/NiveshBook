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
  withdrawalTransactions,
  withdrawalAdjustments,
  withdrawalDestinationAllocations,
  moneyMovements,
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

describe("investment_transactions table schema (Story 3.3; status/reversalOfTransactionId columns added Story 3.8)", () => {
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

  it("marks status NOT NULL with an 'active' DB-side default (Story 3.8, FR42) -- every pre-Story-3.8 row, and every ordinary create/edit, needs no migration-time backfill", () => {
    expect(investmentTransactions.status.notNull).toBe(true);
    expect(investmentTransactions.status.hasDefault).toBe(true);
    expect(investmentTransactions.status.columnType).toBe("PgText");
    expect(investmentTransactions.status.default).toBe("active");
  });

  it("leaves reversalOfTransactionId nullable with no implicit default -- null on every row except a reversal row itself (Story 3.8)", () => {
    expect(investmentTransactions.reversalOfTransactionId.notNull).toBe(false);
    expect(investmentTransactions.reversalOfTransactionId.hasDefault).toBe(false);
    expect(investmentTransactions.reversalOfTransactionId.columnType).toBe("PgUUID");
  });

  it("self-references investment_transactions.id via reversalOfTransactionId (Story 3.8) -- the linked-reversal-row FK", () => {
    const { foreignKeys } = getTableConfig(investmentTransactions);
    const reversalFk = foreignKeys.find((fk) =>
      fk.reference().columns.some((column) => column.name === "reversal_of_transaction_id"),
    );
    expect(reversalFk).toBeDefined();
    const ref = reversalFk!.reference();
    expect(ref.foreignTable).toBe(investmentTransactions);
    expect(ref.foreignColumns.map((column) => column.name)).toEqual(["id"]);
  });

  it("indexes (projectId, status) for sumActiveAmountByProjectId (Story 4.1) -- projectId leading, since it's the sole equality filter", () => {
    const { indexes } = getTableConfig(investmentTransactions);
    const projectStatusIndex = indexes.find((idx) => idx.config.name === "investment_transactions_project_id_status_idx");
    expect(projectStatusIndex).toBeDefined();
    expect(projectStatusIndex!.config.columns.map((column) => (column as { name: string }).name)).toEqual([
      "project_id",
      "status",
    ]);
  });
});

describe("withdrawal_transactions table schema (Story 4.2)", () => {
  it("marks projectId/partyType/shareId/sharePercentSnapshot/canTakeSnapshot/amount/transactionDate/paymentMode/idempotencyKey NOT NULL", () => {
    expect(withdrawalTransactions.projectId.notNull).toBe(true);
    expect(withdrawalTransactions.partyType.notNull).toBe(true);
    expect(withdrawalTransactions.shareId.notNull).toBe(true);
    expect(withdrawalTransactions.sharePercentSnapshot.notNull).toBe(true);
    expect(withdrawalTransactions.canTakeSnapshot.notNull).toBe(true);
    expect(withdrawalTransactions.amount.notNull).toBe(true);
    expect(withdrawalTransactions.transactionDate.notNull).toBe(true);
    expect(withdrawalTransactions.paymentMode.notNull).toBe(true);
    expect(withdrawalTransactions.idempotencyKey.notNull).toBe(true);
  });

  it("gives id no implicit default -- application code (uuidv7) always supplies one", () => {
    expect(withdrawalTransactions.id.hasDefault).toBe(false);
  });

  it("leaves referenceNumber/notes nullable -- both optional, mirroring investment_transactions' identical precedent", () => {
    expect(withdrawalTransactions.referenceNumber.notNull).toBe(false);
    expect(withdrawalTransactions.notes.notNull).toBe(false);
  });

  it("stores sharePercentSnapshot as numeric(7,4), mirroring partner_shares.sharePercent's precision", () => {
    expect(withdrawalTransactions.sharePercentSnapshot.columnType).toBe("PgNumeric");
    expect(withdrawalTransactions.sharePercentSnapshot.getSQLType()).toBe("numeric(7, 4)");
  });

  it("stores canTakeSnapshot/amount as numeric(14,2), mirroring investment_requirements.amount's precision", () => {
    expect(withdrawalTransactions.canTakeSnapshot.columnType).toBe("PgNumeric");
    expect(withdrawalTransactions.canTakeSnapshot.getSQLType()).toBe("numeric(14, 2)");
    expect(withdrawalTransactions.amount.columnType).toBe("PgNumeric");
    expect(withdrawalTransactions.amount.getSQLType()).toBe("numeric(14, 2)");
  });

  it("stores transactionDate as a plain date column (no time component)", () => {
    expect(withdrawalTransactions.transactionDate.columnType).toBe("PgDateString");
    expect(withdrawalTransactions.transactionDate.getSQLType()).toBe("date");
  });

  it("stores shareId as uuid with no FK reference -- mirrors investment_transactions.shareId's identical precedent (this story's Code Map)", () => {
    expect(withdrawalTransactions.shareId.columnType).toBe("PgUUID");
  });

  it("enforces idempotencyKey UNIQUE at the DB level -- the actual double-submit protection, not just an application-layer check", () => {
    expect(withdrawalTransactions.idempotencyKey.isUnique).toBe(true);
  });

  it("marks createdAt NOT NULL with a DB-side default", () => {
    expect(withdrawalTransactions.createdAt.notNull).toBe(true);
    expect(withdrawalTransactions.createdAt.hasDefault).toBe(true);
  });

  it("marks status NOT NULL with an 'active' DB-side default (Story 4.11) -- mirrors investment_transactions.status's identical Story 3.8 shape one ledger over, no migration-time backfill needed", () => {
    expect(withdrawalTransactions.status.notNull).toBe(true);
    expect(withdrawalTransactions.status.hasDefault).toBe(true);
    expect(withdrawalTransactions.status.columnType).toBe("PgText");
    expect(withdrawalTransactions.status.default).toBe("active");
  });

  it("leaves reversalOfTransactionId nullable with no implicit default -- null on every row except a reversal row itself (Story 4.11)", () => {
    expect(withdrawalTransactions.reversalOfTransactionId.notNull).toBe(false);
    expect(withdrawalTransactions.reversalOfTransactionId.hasDefault).toBe(false);
    expect(withdrawalTransactions.reversalOfTransactionId.columnType).toBe("PgUUID");
  });

  it("self-references withdrawal_transactions.id via reversalOfTransactionId (Story 4.11) -- the linked-reversal-row FK", () => {
    const { foreignKeys } = getTableConfig(withdrawalTransactions);
    const reversalFk = foreignKeys.find((fk) =>
      fk.reference().columns.some((column) => column.name === "reversal_of_transaction_id"),
    );
    expect(reversalFk).toBeDefined();
    const ref = reversalFk!.reference();
    expect(ref.foreignTable).toBe(withdrawalTransactions);
    expect(ref.foreignColumns.map((column) => column.name)).toEqual(["id"]);
  });

  it("indexes reversalOfTransactionId for cancelTransaction's idempotent-replay/concurrent-race recovery lookups (Story 4.11)", () => {
    const { indexes } = getTableConfig(withdrawalTransactions);
    const reversalIndex = indexes.find(
      (idx) => idx.config.name === "withdrawal_transactions_reversal_of_transaction_id_idx",
    );
    expect(reversalIndex).toBeDefined();
    expect(reversalIndex!.config.columns.map((column) => (column as { name: string }).name)).toEqual([
      "reversal_of_transaction_id",
    ]);
  });

  it("cascade-deletes when its projectId's project is deleted", () => {
    const { foreignKeys } = getTableConfig(withdrawalTransactions);
    const projectFk = foreignKeys.find((fk) =>
      fk.reference().columns.some((column) => column.name === "project_id"),
    );
    expect(projectFk).toBeDefined();
    expect(projectFk!.onDelete).toBe("cascade");
  });

  it("indexes projectId (primary read pattern -- Project-scoped, unlike investment_transactions' per-requirement listByRequirementId) and (shareId, projectId) per AD-4", () => {
    const { indexes } = getTableConfig(withdrawalTransactions);
    const projectIndex = indexes.find((idx) => idx.config.name === "withdrawal_transactions_project_id_idx");
    expect(projectIndex).toBeDefined();
    expect(projectIndex!.config.columns.map((column) => (column as { name: string }).name)).toEqual([
      "project_id",
    ]);

    const shareProjectIndex = indexes.find(
      (idx) => idx.config.name === "withdrawal_transactions_share_id_project_id_idx",
    );
    expect(shareProjectIndex).toBeDefined();
    expect(
      shareProjectIndex!.config.columns.map((column) => (column as { name: string }).name),
    ).toEqual(["share_id", "project_id"]);
  });
});

describe("withdrawal_adjustments table schema (Story 4.3)", () => {
  it("marks projectId/partyType/shareId/canTake/taken/adjustmentAmount/adjustmentType NOT NULL", () => {
    expect(withdrawalAdjustments.projectId.notNull).toBe(true);
    expect(withdrawalAdjustments.partyType.notNull).toBe(true);
    expect(withdrawalAdjustments.shareId.notNull).toBe(true);
    expect(withdrawalAdjustments.canTake.notNull).toBe(true);
    expect(withdrawalAdjustments.taken.notNull).toBe(true);
    expect(withdrawalAdjustments.adjustmentAmount.notNull).toBe(true);
    expect(withdrawalAdjustments.adjustmentType.notNull).toBe(true);
  });

  it("has no requirementId column -- unlike investment_adjustments, Can Take has no funding-round equivalent (this story's Decisions)", () => {
    expect(Object.keys(withdrawalAdjustments)).not.toContain("requirementId");
  });

  it("gives id no implicit default -- application code (uuidv7) always supplies one", () => {
    expect(withdrawalAdjustments.id.hasDefault).toBe(false);
  });

  it("stores canTake/taken/adjustmentAmount as numeric(14,2), mirroring investment_adjustments.shouldPay's precision", () => {
    expect(withdrawalAdjustments.canTake.columnType).toBe("PgNumeric");
    expect(withdrawalAdjustments.canTake.getSQLType()).toBe("numeric(14, 2)");
    expect(withdrawalAdjustments.taken.columnType).toBe("PgNumeric");
    expect(withdrawalAdjustments.taken.getSQLType()).toBe("numeric(14, 2)");
    expect(withdrawalAdjustments.adjustmentAmount.columnType).toBe("PgNumeric");
    expect(withdrawalAdjustments.adjustmentAmount.getSQLType()).toBe("numeric(14, 2)");
  });

  it("stores shareId as uuid with no FK reference -- mirrors investment_adjustments.shareId's precedent", () => {
    expect(withdrawalAdjustments.shareId.columnType).toBe("PgUUID");
  });

  it("cascade-deletes when its projectId's project is deleted", () => {
    const { foreignKeys } = getTableConfig(withdrawalAdjustments);
    const projectFk = foreignKeys.find((fk) =>
      fk.reference().columns.some((column) => column.name === "project_id"),
    );
    expect(projectFk).toBeDefined();
    expect(projectFk!.onDelete).toBe("cascade");
  });

  it("enforces a composite UNIQUE constraint on (partyType, shareId, projectId) -- the single-row-per-person guarantee (this story's Boundaries), not just an application-layer check", () => {
    const { uniqueConstraints } = getTableConfig(withdrawalAdjustments);
    expect(uniqueConstraints).toHaveLength(1);
    const constraint = uniqueConstraints[0];
    expect(constraint?.columns.map((column) => column.name)).toEqual([
      "party_type",
      "share_id",
      "project_id",
    ]);
  });

  it("marks updatedAt/createdAt NOT NULL with a DB-side default", () => {
    expect(withdrawalAdjustments.updatedAt.notNull).toBe(true);
    expect(withdrawalAdjustments.updatedAt.hasDefault).toBe(true);
    expect(withdrawalAdjustments.createdAt.notNull).toBe(true);
    expect(withdrawalAdjustments.createdAt.hasDefault).toBe(true);
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

describe("audit_log table schema (Story 3.3, AD-5; idempotencyKey column added Story 3.7)", () => {
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

  it("leaves idempotencyKey nullable but UNIQUE-when-present (Story 3.7) -- 'create' entries carry none, 'edit'/'cancel' entries do; mirrors investment_transactions.idempotencyKey's UNIQUE-at-the-DB-level precedent, minus the NOT NULL (Postgres allows multiple NULLs under a UNIQUE constraint)", () => {
    expect(auditLog.idempotencyKey.notNull).toBe(false);
    expect(auditLog.idempotencyKey.isUnique).toBe(true);
  });
});

describe("withdrawal_destination_allocations table schema (Story 4.7, FR27)", () => {
  it("marks withdrawalTransactionId/destinationType/amount/idempotencyKey NOT NULL", () => {
    expect(withdrawalDestinationAllocations.withdrawalTransactionId.notNull).toBe(true);
    expect(withdrawalDestinationAllocations.destinationType.notNull).toBe(true);
    expect(withdrawalDestinationAllocations.amount.notNull).toBe(true);
    expect(withdrawalDestinationAllocations.idempotencyKey.notNull).toBe(true);
  });

  it("leaves destinationProjectId/personName/notes nullable -- only the field(s) matching a leg's destinationType are ever populated", () => {
    expect(withdrawalDestinationAllocations.destinationProjectId.notNull).toBe(false);
    expect(withdrawalDestinationAllocations.personName.notNull).toBe(false);
    expect(withdrawalDestinationAllocations.notes.notNull).toBe(false);
  });

  it("gives id no implicit default -- application code (uuidv7) always supplies one", () => {
    expect(withdrawalDestinationAllocations.id.hasDefault).toBe(false);
  });

  it("stores amount as numeric(14,2), mirroring withdrawal_transactions.amount's exact precision", () => {
    expect(withdrawalDestinationAllocations.amount.columnType).toBe("PgNumeric");
    expect(withdrawalDestinationAllocations.amount.getSQLType()).toBe("numeric(14, 2)");
  });

  it("leaves idempotencyKey NOT unique -- one save legitimately inserts several sibling rows sharing one key (this story's Decisions), unlike withdrawal_transactions.idempotencyKey", () => {
    expect(withdrawalDestinationAllocations.idempotencyKey.isUnique).toBeFalsy();
  });

  it("cascade-deletes with its parent withdrawal_transactions row, but not with destinationProjectId's projects row", () => {
    const { foreignKeys } = getTableConfig(withdrawalDestinationAllocations);
    const parentFk = foreignKeys.find((fk) => fk.reference().columns[0]?.name === "withdrawal_transaction_id");
    expect(parentFk?.onDelete).toBe("cascade");
    const projectFk = foreignKeys.find((fk) => fk.reference().columns[0]?.name === "destination_project_id");
    expect(projectFk?.onDelete).not.toBe("cascade");
  });

  it("indexes withdrawalTransactionId and idempotencyKey -- this table's primary lookup patterns", () => {
    const { indexes } = getTableConfig(withdrawalDestinationAllocations);
    expect(
      indexes.some((idx) => idx.config.name === "withdrawal_destination_allocations_withdrawal_transaction_id_idx"),
    ).toBe(true);
    expect(
      indexes.some((idx) => idx.config.name === "withdrawal_destination_allocations_idempotency_key_idx"),
    ).toBe(true);
  });

  it("marks createdAt NOT NULL with a DB-side default", () => {
    expect(withdrawalDestinationAllocations.createdAt.notNull).toBe(true);
    expect(withdrawalDestinationAllocations.createdAt.hasDefault).toBe(true);
  });

  it("has no status column -- allocation is write-once, not editable/re-enterable (this story's Decisions)", () => {
    expect(Object.keys(withdrawalDestinationAllocations)).not.toContain("status");
  });

  it("Story 4.8 (FR28): leaves destinationRequirementId/destinationShareId/destinationPartyType nullable -- non-breaking, populated only for a 'project' leg", () => {
    expect(withdrawalDestinationAllocations.destinationRequirementId.notNull).toBe(false);
    expect(withdrawalDestinationAllocations.destinationShareId.notNull).toBe(false);
    expect(withdrawalDestinationAllocations.destinationPartyType.notNull).toBe(false);
  });

  it("Story 4.8: destinationRequirementId references investment_requirements but does not cascade-delete -- mirrors destinationProjectId's identical precedent", () => {
    const { foreignKeys } = getTableConfig(withdrawalDestinationAllocations);
    const requirementFk = foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "destination_requirement_id",
    );
    expect(requirementFk).toBeDefined();
    expect(requirementFk?.onDelete).not.toBe("cascade");
  });

  it("Story 4.8: destinationShareId is a plain uuid with no FK reference -- mirrors investment_transactions.shareId's precedent", () => {
    const { foreignKeys } = getTableConfig(withdrawalDestinationAllocations);
    expect(
      foreignKeys.some((fk) => fk.reference().columns[0]?.name === "destination_share_id"),
    ).toBe(false);
  });
});

describe("money_movements table schema (Story 4.8, FR28, AD-6)", () => {
  it("marks sourceProjectId/destinationProjectId/destinationInvestmentTransactionId/amount NOT NULL", () => {
    expect(moneyMovements.sourceProjectId.notNull).toBe(true);
    expect(moneyMovements.destinationProjectId.notNull).toBe(true);
    expect(moneyMovements.destinationInvestmentTransactionId.notNull).toBe(true);
    expect(moneyMovements.amount.notNull).toBe(true);
  });

  // Story 4.9 (FR29): widened to nullable -- an "available_balance" spend's
  // own linked movement sets availableBalanceSpendId instead, and vice
  // versa (this story's Decisions #6, non-breaking).
  it("Story 4.9: withdrawalDestinationAllocationId/availableBalanceSpendId are BOTH nullable -- exactly one is set per row, never both, never neither", () => {
    expect(moneyMovements.withdrawalDestinationAllocationId.notNull).toBe(false);
    expect(moneyMovements.availableBalanceSpendId.notNull).toBe(false);
  });

  it("gives id no implicit default -- application code (uuidv7) always supplies one", () => {
    expect(moneyMovements.id.hasDefault).toBe(false);
  });

  it("stores amount as numeric(14,2), mirroring withdrawal_destination_allocations.amount's exact precision", () => {
    expect(moneyMovements.amount.columnType).toBe("PgNumeric");
    expect(moneyMovements.amount.getSQLType()).toBe("numeric(14, 2)");
  });

  it("cascade-deletes with its parent withdrawal_destination_allocations row, but not with sourceProjectId/destinationProjectId/destinationInvestmentTransactionId's own rows", () => {
    const { foreignKeys } = getTableConfig(moneyMovements);
    const parentFk = foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "withdrawal_destination_allocation_id",
    );
    expect(parentFk?.onDelete).toBe("cascade");
    const sourceProjectFk = foreignKeys.find((fk) => fk.reference().columns[0]?.name === "source_project_id");
    expect(sourceProjectFk?.onDelete).not.toBe("cascade");
    const destinationProjectFk = foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "destination_project_id",
    );
    expect(destinationProjectFk?.onDelete).not.toBe("cascade");
    const investmentTransactionFk = foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "destination_investment_transaction_id",
    );
    expect(investmentTransactionFk?.onDelete).not.toBe("cascade");
  });

  it("indexes withdrawalDestinationAllocationId and destinationProjectId -- this table's primary lookup patterns", () => {
    const { indexes } = getTableConfig(moneyMovements);
    expect(
      indexes.some((idx) => idx.config.name === "money_movements_withdrawal_destination_allocation_id_idx"),
    ).toBe(true);
    expect(indexes.some((idx) => idx.config.name === "money_movements_destination_project_id_idx")).toBe(true);
  });

  it("marks createdAt NOT NULL with a DB-side default", () => {
    expect(moneyMovements.createdAt.notNull).toBe(true);
    expect(moneyMovements.createdAt.hasDefault).toBe(true);
  });

  it("has no status/cancel column -- never edited/cancelled directly, it lives and dies with its parent allocation leg", () => {
    expect(Object.keys(moneyMovements)).not.toContain("status");
  });
});
