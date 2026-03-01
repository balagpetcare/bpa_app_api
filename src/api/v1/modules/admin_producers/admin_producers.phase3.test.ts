/**
 * Phase 3: audit filters (entityType, actionKey, fromDate, toDate) and metrics/print-jobs.
 */

const { getAuditEvents, getProducerMetrics, getPrintJobs } = require("./admin_producers.service");

describe("admin_producers.service Phase 3", () => {
  describe("getAuditEvents", () => {
    test("passes entityType and actionKey to where", async () => {
      const items = [
        { id: 1, orgId: 10, entityType: "PRODUCER_ORG", actionKey: "admin.producer.suspend", createdAt: new Date() },
      ];
      const findMany = jest.fn().mockResolvedValue(items);
      const prisma = { auditEvent: { findMany } };
      await getAuditEvents(prisma, 10, {
        limit: 50,
        offset: 0,
        entityType: "PRODUCER_ORG",
        actionKey: "admin.producer.suspend",
      });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: 10,
            entityType: "PRODUCER_ORG",
            actionKey: "admin.producer.suspend",
          }),
          take: 50,
          skip: 0,
        })
      );
    });

    test("passes fromDate and toDate to where.createdAt", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = { auditEvent: { findMany } };
      const fromDate = "2026-02-01T00:00:00.000Z";
      const toDate = "2026-02-28T23:59:59.999Z";
      await getAuditEvents(prisma, 10, { fromDate, toDate });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: 10,
            createdAt: expect.objectContaining({
              gte: new Date(fromDate),
              lte: expect.any(Date),
            }),
          }),
        })
      );
    });
  });

  describe("getProducerMetrics", () => {
    test("returns null when org not found", async () => {
      const prisma = {
        producerOrg: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const result = await getProducerMetrics(prisma, 999);
      expect(result).toBeNull();
    });

    test("returns counts and usage when org exists", async () => {
      const prisma = {
        producerOrg: {
          findUnique: jest.fn().mockResolvedValue({ id: 1, name: "Test", status: "VERIFIED", updatedAt: new Date() }),
        },
        producerApproval: { count: jest.fn().mockResolvedValue(2) },
        producerAuditLog: { count: jest.fn().mockResolvedValue(5) },
        authBatch: { count: jest.fn().mockResolvedValue(1) },
        producerOrgStaff: { count: jest.fn().mockResolvedValue(3) },
        auditEvent: { count: jest.fn().mockResolvedValue(10) },
        orgQuota: { findMany: jest.fn().mockResolvedValue([{ key: "producer.print.daily", limit: 2000, used: 100 }]) },
      };
      const result = await getProducerMetrics(prisma, 1);
      expect(result).not.toBeNull();
      expect(result?.orgId).toBe(1);
      expect(result?.counts?.pendingApprovals).toBe(2);
      expect(result?.counts?.staffCount).toBe(3);
      expect(result?.usage).toHaveLength(1);
      expect(result?.usage?.[0]?.key).toBe("producer.print.daily");
    });
  });

  describe("getPrintJobs", () => {
    test("returns null when org not found", async () => {
      const prisma = {
        producerOrg: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const result = await getPrintJobs(prisma, 999, {});
      expect(result).toBeNull();
    });

    test("queries ProducerAuditLog with action in BATCH_PRINTED, BATCH_REPRINTED", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const prisma = {
        producerOrg: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
        producerAuditLog: { findMany, count },
      };
      await getPrintJobs(prisma, 1, { limit: 20 });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            producerOrgId: 1,
            action: { in: ["BATCH_PRINTED", "BATCH_REPRINTED"] },
          }),
          take: 20,
          skip: 0,
        })
      );
    });
  });
});
