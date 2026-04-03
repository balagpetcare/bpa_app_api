/**
 * Producer approvals owner-bypass: owner submit does not create SUBMITTED approval;
 * listApprovals returns only SUBMITTED (pending) by default.
 */
describe("producer approval owner bypass", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("listApprovals uses status SUBMITTED when status param is not APPROVED or REJECTED", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const mockPrisma = {
      producerApproval: { findMany },
    };
    const prismaPath = require.resolve("../../../../infrastructure/db/prismaClient");
    jest.doMock(prismaPath, () => mockPrisma);

    const approvalService = require("./producerApproval.service");
    await approvalService.listApprovals(1, {});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ producerOrgId: 1, status: "SUBMITTED" }),
      })
    );
  });

  test("listApprovals uses status APPROVED when params.status is APPROVED", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const mockPrisma = {
      producerApproval: { findMany },
    };
    const prismaPath = require.resolve("../../../../infrastructure/db/prismaClient");
    jest.doMock(prismaPath, () => mockPrisma);

    const approvalService = require("./producerApproval.service");
    await approvalService.listApprovals(1, { status: "APPROVED" });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "APPROVED" }),
      })
    );
  });

  test("autoApproveProductAsOwner returns approval with status APPROVED and product UNDER_REVIEW", async () => {
    const productId = 10;
    const producerOrgId = 1;
    const userId = 100;
    const now = new Date();
    const updatedProduct = { id: productId, status: "UNDER_REVIEW", submittedAt: now, reviewedAt: now };
    const approvalRow = {
      id: 1,
      producerOrgId,
      entityType: "PRODUCT",
      entityId: productId,
      status: "APPROVED",
      submittedByUserId: userId,
      reviewedByUserId: userId,
      reviewedAt: now,
    };
    const authProductFindFirst = jest.fn().mockResolvedValue({ id: productId, status: "DRAFT" });
    const authProductUpdate = jest.fn().mockResolvedValue(updatedProduct);
    const producerApprovalUpsert = jest.fn().mockResolvedValue(approvalRow);
    const transactionFn = jest.fn().mockImplementation(async (cb) => {
      const tx = {
        authProduct: { update: authProductUpdate },
        producerApproval: { upsert: producerApprovalUpsert },
      };
      return cb(tx);
    });
    const mockPrisma = {
      authProduct: { findFirst: authProductFindFirst },
      $transaction: transactionFn,
    };
    const prismaPath = require.resolve("../../../../infrastructure/db/prismaClient");
    jest.doMock(prismaPath, () => mockPrisma);

    const approvalService = require("./producerApproval.service");
    const result = await approvalService.autoApproveProductAsOwner(producerOrgId, productId, userId);

    expect(result.approval.status).toBe("APPROVED");
    expect(result.product.status).toBe("UNDER_REVIEW");
    expect(result.previousStatus).toBe("DRAFT");
    expect(producerApprovalUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "APPROVED", reviewedByUserId: userId }),
        create: expect.objectContaining({ status: "APPROVED", reviewedByUserId: userId }),
      })
    );
  });

  test("submitProductForApproval (staff path) creates SUBMITTED approval", async () => {
    const productId = 10;
    const producerOrgId = 1;
    const userId = 200;
    const approvalRow = {
      id: 1,
      producerOrgId,
      entityType: "PRODUCT",
      entityId: productId,
      status: "SUBMITTED",
      submittedByUserId: userId,
    };
    const authProductFindFirst = jest.fn().mockResolvedValue({ id: productId });
    const producerApprovalUpsert = jest.fn().mockResolvedValue(approvalRow);
    const mockPrisma = {
      producerOrg: { findUnique: jest.fn().mockResolvedValue({ status: "VERIFIED" }) },
      authProduct: { findFirst: authProductFindFirst },
      producerApproval: { upsert: producerApprovalUpsert },
    };
    const prismaPath = require.resolve("../../../../infrastructure/db/prismaClient");
    jest.doMock(prismaPath, () => mockPrisma);

    const approvalService = require("./producerApproval.service");
    const result = await approvalService.submitProductForApproval(producerOrgId, productId, userId);

    expect(result.status).toBe("SUBMITTED");
    expect(producerApprovalUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "SUBMITTED" }),
        create: expect.objectContaining({ status: "SUBMITTED", submittedByUserId: userId }),
      })
    );
  });

  test("autoApproveBatchAsOwner returns approval with status APPROVED", async () => {
    const batchId = 5;
    const producerOrgId = 1;
    const userId = 100;
    const approvalRow = {
      id: 1,
      producerOrgId,
      entityType: "BATCH",
      entityId: batchId,
      status: "APPROVED",
      submittedByUserId: userId,
      reviewedByUserId: userId,
    };
    const authBatchFindFirst = jest.fn().mockResolvedValue({ id: batchId });
    const authBatchUpdate = jest.fn().mockResolvedValue({ id: batchId, status: "APPROVED" });
    const producerApprovalUpsert = jest.fn().mockResolvedValue(approvalRow);
    const transactionFn = jest.fn().mockImplementation(async (cb) => {
      const tx = {
        authBatch: { update: authBatchUpdate },
        producerApproval: { upsert: producerApprovalUpsert },
      };
      return cb(tx);
    });
    const mockPrisma = {
      authBatch: { findFirst: authBatchFindFirst },
      $transaction: transactionFn,
    };
    const prismaPath = require.resolve("../../../../infrastructure/db/prismaClient");
    jest.doMock(prismaPath, () => mockPrisma);

    const approvalService = require("./producerApproval.service");
    const result = await approvalService.autoApproveBatchAsOwner(producerOrgId, batchId, userId);

    expect(result.approval.status).toBe("APPROVED");
    expect(producerApprovalUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "APPROVED" }),
        create: expect.objectContaining({ status: "APPROVED" }),
      })
    );
  });
});
