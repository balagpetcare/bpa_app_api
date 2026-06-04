/**
 * Ensures legacy OWNER / implicit owner permission expansion includes enterprise pricing keys.
 */

const { LEGACY_ROLE_PERMS } = require("./permissions");
const { OWNER_ENTERPRISE_PRICING_PERMS } = require("../constants/pricingOwnerPermissions");

jest.mock("../../../infrastructure/db/prismaClient", () => ({}));
jest.mock("../services/authUnified.service", () => ({ isAdminAllowed: async () => false }));

describe("legacy OWNER pricing RBAC", () => {
  test("OWNER legacy matrix includes central governance write and read", () => {
    expect(LEGACY_ROLE_PERMS.OWNER).toContain("pricing.central.write");
    expect(LEGACY_ROLE_PERMS.OWNER).toContain("pricing.central.read");
    expect(LEGACY_ROLE_PERMS.OWNER).toContain("pricing.audit.view");
    for (const k of OWNER_ENTERPRISE_PRICING_PERMS) {
      expect(LEGACY_ROLE_PERMS.OWNER).toContain(k);
    }
  });
});
