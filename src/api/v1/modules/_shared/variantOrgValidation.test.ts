/**
 * Org catalog guard: variants must belong to Product.orgId for the tenant.
 */
import { assertVariantsBelongToOrg } from "./variantOrgValidation";

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {
    productVariant: {
      findMany: jest.fn(),
    },
  },
}));

const prismaMock = require("../../../../infrastructure/db/prismaClient").default;

describe("assertVariantsBelongToOrg", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves when all variants exist under org catalog", async () => {
    prismaMock.productVariant.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    await expect(assertVariantsBelongToOrg(10, [1, 2])).resolves.toBeUndefined();
    expect(prismaMock.productVariant.findMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] }, product: { orgId: 10 } },
      select: { id: true },
    });
  });

  it("throws when a variant is missing or wrong org", async () => {
    prismaMock.productVariant.findMany.mockResolvedValue([{ id: 1 }]);
    await expect(assertVariantsBelongToOrg(10, [1, 99])).rejects.toThrow(/organization/);
  });

  it("no-ops for empty input", async () => {
    await assertVariantsBelongToOrg(10, []);
    expect(prismaMock.productVariant.findMany).not.toHaveBeenCalled();
  });
});
