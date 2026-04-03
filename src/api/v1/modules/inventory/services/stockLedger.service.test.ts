import { getAvailableStock } from "./stockLedger.service";

jest.mock("../../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {
    inventoryLocation: {
      findMany: jest.fn(),
    },
    stockBalance: {
      findMany: jest.fn(),
    },
  },
}));

import prisma from "../../../../../infrastructure/db/prismaClient";

describe("getAvailableStock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sums available qty across warehouse locations", async () => {
    (prisma.inventoryLocation.findMany as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }]);
    (prisma.stockBalance.findMany as jest.Mock).mockResolvedValue([
      { onHandQty: 10, reservedQty: 2 },
      { onHandQty: 5, reservedQty: 0 },
    ]);

    const total = await getAvailableStock(1, 100, 50);
    expect(total).toBe(13);
    expect(prisma.inventoryLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          warehouseId: 100,
          branch: { orgId: 1 },
        }),
      })
    );
  });

  it("returns 0 when no locations", async () => {
    (prisma.inventoryLocation.findMany as jest.Mock).mockResolvedValue([]);
    const total = await getAvailableStock(1, 100, 50);
    expect(total).toBe(0);
    expect(prisma.stockBalance.findMany).not.toHaveBeenCalled();
  });
});
