import {
  allowedRolesForServiceCategory,
  assertRoleAllowedForCategory,
  buildAllowedRolesByCategoryRecord,
  isKnownAssignmentRole,
} from "./doctorServiceAssignmentRoles";

describe("doctorServiceAssignmentRoles", () => {
  it("allows standard roles for consultation-like categories", () => {
    const roles = allowedRolesForServiceCategory("CONSULTATION");
    expect(roles).toContain("CONSULTANT");
    expect(roles).toContain("REVIEWER");
  });

  it("prioritizes surgeon roles for surgery categories", () => {
    const roles = allowedRolesForServiceCategory("SURGERY");
    expect(roles[0]).toBe("SURGEON");
  });

  it("validates known roles", () => {
    expect(isKnownAssignmentRole("CONSULTANT")).toBe(true);
    expect(isKnownAssignmentRole("INVALID")).toBe(false);
  });

  it("buildAllowedRolesByCategoryRecord covers all ServiceCategory enum values", () => {
    const rec = buildAllowedRolesByCategoryRecord();
    expect(Object.keys(rec).length).toBeGreaterThanOrEqual(10);
    expect(rec.SURGERY).toContain("SURGEON");
  });

  it("assertRoleAllowedForCategory throws on bad role", () => {
    expect(() => assertRoleAllowedForCategory("NOT_A_ROLE", "CONSULTATION")).toThrow();
  });
});
