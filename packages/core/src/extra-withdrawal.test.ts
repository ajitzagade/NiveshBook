import { describe, it, expect } from "vitest";
import type { Money, UserRole } from "@niveshbook/types";
import {
  assertExtraWithdrawalAuthorized,
  OwnerAdminRequiredForExtraWithdrawalError,
  ExtraWithdrawalAuthorizationRequiredError,
  type AssertExtraWithdrawalAuthorizedInput,
} from "./extra-withdrawal";

function makeInput(
  overrides: Partial<AssertExtraWithdrawalAuthorizedInput> = {},
): AssertExtraWithdrawalAuthorizedInput {
  return {
    requestedAmount: "300000" as Money,
    canTake: "250000" as Money,
    actorRole: "owner_admin" as UserRole,
    actorCanApproveExtraWithdrawal: true,
    extraWithdrawalAuthorized: true,
    ...overrides,
  };
}

describe("assertExtraWithdrawalAuthorized", () => {
  it("AC: Owner/Admin with the grant, amount exceeds Can Take, extraWithdrawalAuthorized true -- no-op (allowed)", () => {
    expect(() => assertExtraWithdrawalAuthorized(makeInput())).not.toThrow();
  });

  it("within Can Take -- a no-op regardless of role/grant/authorization (no behavior change for the common case)", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(
        makeInput({
          requestedAmount: "200000" as Money,
          canTake: "250000" as Money,
          actorRole: "partner" as UserRole,
          actorCanApproveExtraWithdrawal: false,
          extraWithdrawalAuthorized: false,
        }),
      ),
    ).not.toThrow();
  });

  it("exact-match amount (amount === canTake) is treated as within Can Take, not 'exceeds' -- the gate does not trigger", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(
        makeInput({
          requestedAmount: "250000" as Money,
          canTake: "250000" as Money,
          actorRole: "partner" as UserRole,
          actorCanApproveExtraWithdrawal: false,
          extraWithdrawalAuthorized: false,
        }),
      ),
    ).not.toThrow();
  });

  it("AC: over-cap attempt without authorization -- Owner/Admin with the grant but extraWithdrawalAuthorized false throws ExtraWithdrawalAuthorizationRequiredError", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(makeInput({ extraWithdrawalAuthorized: false })),
    ).toThrow(ExtraWithdrawalAuthorizationRequiredError);
  });

  it("extraWithdrawalAuthorized omitted (undefined coerced by caller to false) is treated identically to explicit false", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(
        makeInput({ extraWithdrawalAuthorized: undefined as unknown as boolean }),
      ),
    ).toThrow(ExtraWithdrawalAuthorizationRequiredError);
  });

  it("AC: non-Owner/Admin attempting to self-authorize an over-cap amount -- OwnerAdminRequiredForExtraWithdrawalError even with extraWithdrawalAuthorized true", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(
        makeInput({ actorRole: "partner" as UserRole, actorCanApproveExtraWithdrawal: false }),
      ),
    ).toThrow(OwnerAdminRequiredForExtraWithdrawalError);
  });

  it("sub_partner attempting to self-authorize an over-cap amount -- OwnerAdminRequiredForExtraWithdrawalError", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(
        makeInput({ actorRole: "sub_partner" as UserRole, actorCanApproveExtraWithdrawal: false }),
      ),
    ).toThrow(OwnerAdminRequiredForExtraWithdrawalError);
  });

  it("AC: Owner/Admin with a revoked canApproveExtraWithdrawal grant -- OwnerAdminRequiredForExtraWithdrawalError, even with extraWithdrawalAuthorized true", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(makeInput({ actorCanApproveExtraWithdrawal: false })),
    ).toThrow(OwnerAdminRequiredForExtraWithdrawalError);
  });

  it("checks Owner/Admin-eligibility before extraWithdrawalAuthorized -- a non-eligible actor gets the 403-mapped error even when extraWithdrawalAuthorized is also false", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(
        makeInput({
          actorRole: "partner" as UserRole,
          actorCanApproveExtraWithdrawal: false,
          extraWithdrawalAuthorized: false,
        }),
      ),
    ).toThrow(OwnerAdminRequiredForExtraWithdrawalError);
  });

  it("project_admin is not owner_admin -- also rejected regardless of extraWithdrawalAuthorized (v1: only Owner/Admin, not Project Admin, may grant this)", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(
        makeInput({ actorRole: "project_admin" as UserRole, actorCanApproveExtraWithdrawal: false }),
      ),
    ).toThrow(OwnerAdminRequiredForExtraWithdrawalError);
  });

  it("availableReallocationBonus omitted defaults to '0' -- byte-for-byte the same gate behavior as before this field existed", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(
        makeInput({
          requestedAmount: "300000" as Money,
          canTake: "250000" as Money,
          actorRole: "partner" as UserRole,
          actorCanApproveExtraWithdrawal: false,
          extraWithdrawalAuthorized: false,
        }),
      ),
    ).toThrow(OwnerAdminRequiredForExtraWithdrawalError);
  });

  it("an amount within canTake + availableReallocationBonus is a no-op with no Owner/Admin authorization needed at all", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(
        makeInput({
          requestedAmount: "300000" as Money,
          canTake: "250000" as Money,
          availableReallocationBonus: "50000" as Money,
          actorRole: "partner" as UserRole,
          actorCanApproveExtraWithdrawal: false,
          extraWithdrawalAuthorized: false,
        }),
      ),
    ).not.toThrow();
  });

  it("an exact-match amount (requestedAmount === canTake + bonus) is within the boosted ceiling, not 'exceeds'", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(
        makeInput({
          requestedAmount: "300000" as Money,
          canTake: "250000" as Money,
          availableReallocationBonus: "50000" as Money,
          actorRole: "partner" as UserRole,
          actorCanApproveExtraWithdrawal: false,
          extraWithdrawalAuthorized: false,
        }),
      ),
    ).not.toThrow();
  });

  it("an amount beyond canTake + availableReallocationBonus still requires the existing Owner/Admin gate for the excess", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(
        makeInput({
          requestedAmount: "310000" as Money,
          canTake: "250000" as Money,
          availableReallocationBonus: "50000" as Money,
          actorRole: "partner" as UserRole,
          actorCanApproveExtraWithdrawal: false,
          extraWithdrawalAuthorized: false,
        }),
      ),
    ).toThrow(OwnerAdminRequiredForExtraWithdrawalError);
  });

  it("an amount beyond canTake + availableReallocationBonus, authorized by an eligible Owner/Admin, is a no-op", () => {
    expect(() =>
      assertExtraWithdrawalAuthorized(
        makeInput({
          requestedAmount: "310000" as Money,
          canTake: "250000" as Money,
          availableReallocationBonus: "50000" as Money,
          actorRole: "owner_admin" as UserRole,
          actorCanApproveExtraWithdrawal: true,
          extraWithdrawalAuthorized: true,
        }),
      ),
    ).not.toThrow();
  });
});
