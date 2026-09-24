import { describe, it, expect } from "vitest";
import { users, projects, partnerShares, subpartnerShares } from "./schema";

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
