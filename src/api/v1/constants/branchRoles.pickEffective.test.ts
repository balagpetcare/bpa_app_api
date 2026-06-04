import { pickEffectiveBranchRoleKey } from "./branchRoles";

describe("pickEffectiveBranchRoleKey", () => {
  it("prefers BRANCH_MANAGER when join order lists CLINIC_STAFF first", () => {
    expect(
      pickEffectiveBranchRoleKey({
        role: "BRANCH_MANAGER",
        roles: [{ role: { key: "CLINIC_STAFF" } }, { role: { key: "BRANCH_MANAGER" } }],
      })
    ).toBe("BRANCH_MANAGER");
  });

  it("uses sole join role when legacy role absent", () => {
    expect(
      pickEffectiveBranchRoleKey({
        role: null,
        roles: [{ role: { key: "CLINIC_STAFF" } }],
      })
    ).toBe("CLINIC_STAFF");
  });

  it("falls back to legacy BranchMember.role when join empty", () => {
    expect(
      pickEffectiveBranchRoleKey({
        role: "BRANCH_MANAGER",
        roles: [],
      })
    ).toBe("BRANCH_MANAGER");
  });
});
