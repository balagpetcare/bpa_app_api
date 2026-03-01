/**
 * Minimal tests: suspension enforcement, quota enforcement, approval policy blocking.
 */

const {
  checkOrgNotSuspended,
  checkBatchApprovedForCodes,
  checkCanVoidBatch,
} = require("./approvalPolicy.service");
const { requireEnabled } = require("./featureFlag.service");
const { checkAndIncrement } = require("./quota.service");

describe("ApprovalPolicyService", () => {
  test("checkOrgNotSuspended throws when org is SUSPENDED", async () => {
    const mockPrisma = {
      producerOrg: {
        findUnique: jest.fn().mockResolvedValue({ id: 1, status: "SUSPENDED" }),
      },
    };
    await expect(checkOrgNotSuspended(mockPrisma, 1)).rejects.toMatchObject({
      message: "Producer organization is suspended",
      code: "ORG_SUSPENDED",
      statusCode: 403,
    });
  });

  test("checkOrgNotSuspended does not throw when org is VERIFIED", async () => {
    const mockPrisma = {
      producerOrg: {
        findUnique: jest.fn().mockResolvedValue({ id: 1, status: "VERIFIED" }),
      },
    };
    await expect(checkOrgNotSuspended(mockPrisma, 1)).resolves.toBeUndefined();
  });

  test("checkBatchApprovedForCodes throws when batch not found", async () => {
    const mockPrisma = {
      authBatch: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    await expect(checkBatchApprovedForCodes(mockPrisma, 1)).rejects.toMatchObject({
      code: "BATCH_NOT_FOUND",
      statusCode: 404,
    });
  });

  test("checkBatchApprovedForCodes throws when batch status is SUBMITTED", async () => {
    const mockPrisma = {
      authBatch: { findUnique: jest.fn().mockResolvedValue({ id: 1, status: "SUBMITTED" }) },
    };
    await expect(checkBatchApprovedForCodes(mockPrisma, 1)).rejects.toMatchObject({
      code: "BATCH_NOT_APPROVED",
      statusCode: 400,
    });
  });

  test("checkBatchApprovedForCodes does not throw when batch status is APPROVED", async () => {
    const mockPrisma = {
      authBatch: { findUnique: jest.fn().mockResolvedValue({ id: 1, status: "APPROVED" }) },
    };
    await expect(checkBatchApprovedForCodes(mockPrisma, 1)).resolves.toBeUndefined();
  });

  test("checkCanVoidBatch throws when VERIFIED codes exist", async () => {
    const mockPrisma = {
      authCode: { count: jest.fn().mockResolvedValue(3) },
    };
    await expect(checkCanVoidBatch(mockPrisma, 1)).rejects.toMatchObject({
      code: "CODES_ALREADY_VERIFIED",
      statusCode: 400,
    });
  });

  test("checkCanVoidBatch does not throw when no VERIFIED codes", async () => {
    const mockPrisma = {
      authCode: { count: jest.fn().mockResolvedValue(0) },
    };
    await expect(checkCanVoidBatch(mockPrisma, 1)).resolves.toBeUndefined();
  });
});

describe("FeatureFlagService", () => {
  test("requireEnabled throws when flag is disabled", async () => {
    const mockPrisma = {
      orgFeatureFlag: {
        findUnique: jest.fn().mockResolvedValue({ enabled: false }),
      },
    };
    await expect(
      requireEnabled(mockPrisma, 1, "producer.printing.enabled")
    ).rejects.toMatchObject({
      code: "FLAG_DISABLED",
      statusCode: 403,
    });
  });

  test("requireEnabled resolves when flag is enabled", async () => {
    const mockPrisma = {
      orgFeatureFlag: {
        findUnique: jest.fn().mockResolvedValue({ enabled: true }),
      },
    };
    await expect(
      requireEnabled(mockPrisma, 1, "producer.printing.enabled")
    ).resolves.toBeUndefined();
  });
});

describe("QuotaService", () => {
  test("checkAndIncrement throws when would exceed limit", async () => {
    const mockTx = {
      orgQuota: {
        findUnique: jest.fn().mockResolvedValue({
          limit: 10,
          used: 10,
          resetPeriod: "DAILY",
          updatedAt: new Date(),
        }),
        upsert: jest.fn(),
      },
    };
    const mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (cb) => cb(mockTx)),
    };
    await expect(
      checkAndIncrement(mockPrisma, 1, "producer.batches.create.daily", 1)
    ).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      statusCode: 403,
    });
  });
});
