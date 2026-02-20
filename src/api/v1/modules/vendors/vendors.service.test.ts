/**
 * Unit tests for vendor service (create payload uses VendorStatus enum).
 * Guards against regression: status must be VendorStatus.ACTIVE from @prisma/client, not string "ACTIVE".
 */
import { VendorStatus } from "@prisma/client";

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {
    vendor: {
      create: jest.fn(),
    },
  },
}));

jest.mock("./vendors.repo", () => ({
  getNextVendorCode: jest.fn().mockResolvedValue("VEN-0001"),
}));

const prismaMock = require("../../../../infrastructure/db/prismaClient").default;
const service = require("./vendors.service");

describe("vendors.service createVendor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    require("./vendors.repo").getNextVendorCode.mockResolvedValue("VEN-0001");
  });

  it("calls prisma.vendor.create with status VendorStatus.ACTIVE (enum, not string)", async () => {
    prismaMock.vendor.create.mockResolvedValue({
      id: 1,
      orgId: 1,
      name: "Test",
      code: "VEN-0001",
      status: "ACTIVE",
    });
    await service.createVendor({ orgId: 1, name: "Test Vendor" });
    expect(prismaMock.vendor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: VendorStatus.ACTIVE,
        }),
      })
    );
    const createArg = prismaMock.vendor.create.mock.calls[0][0];
    expect(createArg.data.status).toBe(VendorStatus.ACTIVE);
  });
});
