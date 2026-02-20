/**
 * Unit tests for stock request approve (partial + extra items).
 * Verifies status transition and approvedItems/extraItems validation.
 */
const service = require("./stock_requests.service");

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {
    stockRequest: { findUnique: jest.fn(), update: jest.fn() },
    stockLotBalance: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

const prismaMock = require("../../../../infrastructure/db/prismaClient").default;

describe("stock_requests.approveRequest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws when request not found", async () => {
    prismaMock.stockRequest.findUnique.mockResolvedValue(null);
    await expect(
      service.approveRequest(999, {
        approvedItems: [{ variantId: 1, approvedQty: 5 }],
        approvedByUserId: 1,
      })
    ).rejects.toThrow("Stock request not found");
  });

  it("throws when status is not SUBMITTED or OWNER_REVIEW", async () => {
    prismaMock.stockRequest.findUnique.mockResolvedValue({ id: 1, status: "DISPATCHED", items: [] });
    await expect(
      service.approveRequest(1, {
        approvedItems: [{ variantId: 1, approvedQty: 5 }],
        approvedByUserId: 1,
      })
    ).rejects.toThrow("Request cannot be approved in status DISPATCHED");
  });

  it("throws when both approvedItems and extraItems are empty", async () => {
    prismaMock.stockRequest.findUnique.mockResolvedValue({ id: 1, status: "SUBMITTED", items: [] });
    await expect(
      service.approveRequest(1, {
        approvedItems: [],
        extraItems: [],
        approvedByUserId: 1,
      })
    ).rejects.toThrow("At least one approved item or extra item is required");
  });

  it("calls update with OWNER_REVIEW, approvedItems and extraItems", async () => {
    prismaMock.stockRequest.findUnique
      .mockResolvedValueOnce({ id: 1, status: "SUBMITTED", items: [] })
      .mockResolvedValueOnce({
        id: 1,
        org: { id: 1, name: "Org" },
        branch: { id: 1, name: "B", inventoryLocations: [] },
        requester: { id: 1, profile: { displayName: "U" } },
        items: [],
        transfer: null,
      });
    prismaMock.stockRequest.update.mockResolvedValue({});
    const result = await service.approveRequest(1, {
      approvedItems: [{ variantId: 1, approvedQty: 5 }],
      extraItems: [{ variantId: 2, quantity: 3 }],
      approvedByUserId: 10,
    });
    expect(prismaMock.stockRequest.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        status: "OWNER_REVIEW",
        approvedItems: [{ variantId: 1, approvedQty: 5 }],
        extraItems: [{ variantId: 2, quantity: 3 }],
        approvedByUserId: 10,
      }),
    });
    expect(result).toBeDefined();
  });
});
