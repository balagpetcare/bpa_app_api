/**
 * Retail discount approval lifecycle tests.
 * Tests: approval expiry (7 days), consumption tracking, reuse prevention
 * Run with: npx jest retailDiscount.approval.test.ts
 */

const prismaMock = {
  retailDiscountApproval: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  order: {
    findUnique: jest.fn(),
  },
};

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: prismaMock,
}));

const retailDiscountService = require("./retailDiscount.service");

describe("Retail Discount Approval Lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("approval expiry validation", () => {
    it("should reject approvals older than 7 days", async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

      prismaMock.retailDiscountApproval.findMany.mockResolvedValue([
        {
          id: 1,
          reviewedAt: eightDaysAgo,
          status: "APPROVED",
          consumedAt: null,
          orderId: null,
        },
      ]);

      const mockTx = {
        retailDiscountApproval: prismaMock.retailDiscountApproval,
      };

      await expect(
        retailDiscountService.consumeRetailDiscountApprovalsForPaidOrder(123, mockTx)
      ).rejects.toThrow(/APPROVAL_EXPIRED/);

      // Verify no consumption occurred
      expect(prismaMock.retailDiscountApproval.updateMany).not.toHaveBeenCalled();
    });

    it("should accept approvals within 7 days", async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

      prismaMock.retailDiscountApproval.findMany.mockResolvedValue([
        {
          id: 1,
          reviewedAt: threeDaysAgo,
          status: "APPROVED",
          consumedAt: null,
          orderId: null,
        },
      ]);

      prismaMock.order.findUnique.mockResolvedValue({
        id: 123,
        customerId: 1,
        total: 100,
      });

      prismaMock.retailDiscountApproval.updateMany.mockResolvedValue({ count: 1 });

      const mockTx = {
        retailDiscountApproval: prismaMock.retailDiscountApproval,
        order: prismaMock.order,
      };

      await retailDiscountService.consumeRetailDiscountApprovalsForPaidOrder(123, mockTx);

      // Verify consumption occurred
      expect(prismaMock.retailDiscountApproval.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] } },
        data: {
          consumedAt: expect.any(Date),
          orderId: 123,
        },
      });
    });
  });

  describe("approval consumption tracking", () => {
    it("should prevent reuse of already consumed approvals", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      prismaMock.retailDiscountApproval.findMany.mockResolvedValue([
        {
          id: 1,
          reviewedAt: yesterday,
          status: "APPROVED",
          consumedAt: yesterday, // Already consumed
          orderId: 100, // Already tied to another order
        },
      ]);

      const mockTx = {
        retailDiscountApproval: prismaMock.retailDiscountApproval,
      };

      await expect(
        retailDiscountService.consumeRetailDiscountApprovalsForPaidOrder(123, mockTx)
      ).rejects.toThrow(/no eligible approvals/i);

      // Verify no additional consumption occurred
      expect(prismaMock.retailDiscountApproval.updateMany).not.toHaveBeenCalled();
    });

    it("should tie approval to specific order", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      prismaMock.retailDiscountApproval.findMany.mockResolvedValue([
        {
          id: 1,
          reviewedAt: yesterday,
          status: "APPROVED",
          consumedAt: null,
          orderId: null,
          customerId: 1,
          discountPercent: 10,
        },
      ]);

      prismaMock.order.findUnique.mockResolvedValue({
        id: 123,
        customerId: 1,
        total: 100,
      });

      prismaMock.retailDiscountApproval.updateMany.mockResolvedValue({ count: 1 });

      const mockTx = {
        retailDiscountApproval: prismaMock.retailDiscountApproval,
        order: prismaMock.order,
      };

      await retailDiscountService.consumeRetailDiscountApprovalsForPaidOrder(123, mockTx);

      expect(prismaMock.retailDiscountApproval.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] } },
        data: {
          consumedAt: expect.any(Date),
          orderId: 123,
        },
      });
    });
  });

  describe("customer and price validation", () => {
    it("should reject approval for different customer", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      prismaMock.retailDiscountApproval.findMany.mockResolvedValue([
        {
          id: 1,
          reviewedAt: yesterday,
          status: "APPROVED",
          consumedAt: null,
          orderId: null,
          customerId: 1, // Approval for customer 1
        },
      ]);

      prismaMock.order.findUnique.mockResolvedValue({
        id: 123,
        customerId: 2, // Order for customer 2
        total: 100,
      });

      const mockTx = {
        retailDiscountApproval: prismaMock.retailDiscountApproval,
        order: prismaMock.order,
      };

      await expect(
        retailDiscountService.consumeRetailDiscountApprovalsForPaidOrder(123, mockTx)
      ).rejects.toThrow(/no eligible approvals/i);
    });

    it("should validate minimum order value if specified", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      prismaMock.retailDiscountApproval.findMany.mockResolvedValue([
        {
          id: 1,
          reviewedAt: yesterday,
          status: "APPROVED",
          consumedAt: null,
          orderId: null,
          customerId: 1,
          minOrderValue: 200, // Requires minimum 200
        },
      ]);

      prismaMock.order.findUnique.mockResolvedValue({
        id: 123,
        customerId: 1,
        total: 100, // Order total is only 100
      });

      const mockTx = {
        retailDiscountApproval: prismaMock.retailDiscountApproval,
        order: prismaMock.order,
      };

      await expect(
        retailDiscountService.consumeRetailDiscountApprovalsForPaidOrder(123, mockTx)
      ).rejects.toThrow(/no eligible approvals/i);
    });
  });
});
