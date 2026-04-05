/**
 * GRN vendor receive confirmation workflow tests.
 * Tests: submit for confirmation, session status transitions, confirm & post stock,
 *        duplicate confirm prevention, notification triggers, permission checks
 * Run with: npx jest grn.confirmation.test.ts
 */

const prismaMock = {
  $transaction: jest.fn(),
  grn: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  },
  grnLine: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  vendorReceiveSession: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  inventoryLocation: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  stockLot: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  stockLotBalance: {
    findFirst: jest.fn(),
    upsert: jest.fn(),
  },
  organization: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  orgMember: {
    findFirst: jest.fn(),
  },
  branchMember: {
    findMany: jest.fn(),
  },
  branch: {
    findFirst: jest.fn(),
  },
};

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.mock("../inventory/ledger.service", () => ({
  recordLedgerEntryInTx: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../warehouse/warehouseAudit.service", () => ({
  logWarehouseAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../services/warehouseOpsNotifications.service", () => ({
  notifyVendorReceiveSubmittedForConfirmation: jest.fn().mockResolvedValue(undefined),
  notifyGrnConfirmed: jest.fn().mockResolvedValue(undefined),
}));

const grnService = require("./grn.service");
const { logWarehouseAudit } = require("../warehouse/warehouseAudit.service");
const { notifyVendorReceiveSubmittedForConfirmation } = require("../../services/warehouseOpsNotifications.service");

describe("GRN Vendor Receive Confirmation Workflow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("isControlledVendorInboundGrn", () => {
    it("returns true for vendor GRN without dispatch", () => {
      expect(grnService.isControlledVendorInboundGrn({
        stockDispatchId: null, vendorId: 1, purchaseOrderId: null, inboundShipmentId: null,
      })).toBe(true);
    });

    it("returns true for PO GRN without dispatch", () => {
      expect(grnService.isControlledVendorInboundGrn({
        stockDispatchId: null, vendorId: null, purchaseOrderId: 5, inboundShipmentId: null,
      })).toBe(true);
    });

    it("returns false for dispatch-based GRN", () => {
      expect(grnService.isControlledVendorInboundGrn({
        stockDispatchId: 10, vendorId: 1, purchaseOrderId: null, inboundShipmentId: null,
      })).toBe(false);
    });

    it("returns false when no vendor/PO/shipment", () => {
      expect(grnService.isControlledVendorInboundGrn({
        stockDispatchId: null, vendorId: null, purchaseOrderId: null, inboundShipmentId: null,
      })).toBe(false);
    });
  });

  describe("submitVendorReceiveSessionForConfirmation", () => {
    it("transitions session from DRAFT to AWAITING_CONFIRMATION", async () => {
      const mockGrn = {
        id: 1, orgId: 1, status: "DRAFT",
        vendorId: 1, purchaseOrderId: null, stockDispatchId: null, inboundShipmentId: null,
        vendorReceiveSession: { id: 1, grnId: 1, status: "DRAFT" },
        location: { warehouseId: 5 },
      };
      prismaMock.grn.findFirst.mockResolvedValue(mockGrn);
      prismaMock.vendorReceiveSession.update.mockResolvedValue({ ...mockGrn.vendorReceiveSession, status: "AWAITING_CONFIRMATION" });

      const fullGrn = { ...mockGrn, lines: [], vendor: { id: 1, name: "Test" } };
      prismaMock.grn.findFirst
        .mockResolvedValueOnce(mockGrn)
        .mockResolvedValueOnce(fullGrn);

      await grnService.submitVendorReceiveSessionForConfirmation(1, 1, 100);

      expect(prismaMock.vendorReceiveSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { grnId: 1 },
          data: expect.objectContaining({
            status: "AWAITING_CONFIRMATION",
            submittedByUserId: 100,
          }),
        })
      );
      expect(logWarehouseAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "VENDOR_RECEIVE_SUBMITTED_FOR_CONFIRMATION" })
      );
    });

    it("throws if GRN is not DRAFT", async () => {
      prismaMock.grn.findFirst.mockResolvedValue({
        id: 1, orgId: 1, status: "RECEIVED",
        vendorId: 1, purchaseOrderId: null, stockDispatchId: null, inboundShipmentId: null,
        vendorReceiveSession: { status: "POSTED" },
        location: { warehouseId: 5 },
      });

      await expect(
        grnService.submitVendorReceiveSessionForConfirmation(1, 1, 100)
      ).rejects.toThrow("Only DRAFT GRN can be submitted");
    });

    it("is idempotent if already AWAITING_CONFIRMATION", async () => {
      const mockGrn = {
        id: 1, orgId: 1, status: "DRAFT",
        vendorId: 1, purchaseOrderId: null, stockDispatchId: null, inboundShipmentId: null,
        vendorReceiveSession: { id: 1, grnId: 1, status: "AWAITING_CONFIRMATION" },
        location: { warehouseId: 5 },
      };
      prismaMock.grn.findFirst.mockResolvedValue(mockGrn);

      await grnService.submitVendorReceiveSessionForConfirmation(1, 1, 100);

      expect(prismaMock.vendorReceiveSession.update).not.toHaveBeenCalled();
    });

    it("throws for non-vendor/non-PO GRN", async () => {
      prismaMock.grn.findFirst.mockResolvedValue({
        id: 1, orgId: 1, status: "DRAFT",
        vendorId: null, purchaseOrderId: null, stockDispatchId: 5, inboundShipmentId: null,
        vendorReceiveSession: null,
        location: { warehouseId: 5 },
      });

      await expect(
        grnService.submitVendorReceiveSessionForConfirmation(1, 1, 100)
      ).rejects.toThrow("Submit for confirmation applies only to vendor");
    });
  });

  describe("receiveGrn — stock posting protection", () => {
    it("throws if session is DRAFT and allowPostFromDraft is false", async () => {
      prismaMock.grn.findFirst.mockResolvedValue({
        id: 1, orgId: 1, status: "DRAFT",
        vendorId: 1, purchaseOrderId: null, stockDispatchId: null, inboundShipmentId: null,
        vendorReceiveSession: { status: "DRAFT" },
        location: { branch: { orgId: 1 } },
        lines: [{ id: 1, variantId: 1, quantity: 10 }],
      });

      await expect(
        grnService.receiveGrn(1, 1, 100)
      ).rejects.toThrow("Submit for warehouse manager confirmation first");
    });

    it("throws if session is already POSTED (duplicate protection)", async () => {
      prismaMock.grn.findFirst.mockResolvedValue({
        id: 1, orgId: 1, status: "DRAFT",
        vendorId: 1, purchaseOrderId: null, stockDispatchId: null, inboundShipmentId: null,
        vendorReceiveSession: { status: "POSTED" },
        location: { branch: { orgId: 1 } },
        lines: [{ id: 1, variantId: 1, quantity: 10 }],
      });

      await expect(
        grnService.receiveGrn(1, 1, 100)
      ).rejects.toThrow("already been posted");
    });

    it("throws if session is CANCELLED", async () => {
      prismaMock.grn.findFirst.mockResolvedValue({
        id: 1, orgId: 1, status: "DRAFT",
        vendorId: 1, purchaseOrderId: null, stockDispatchId: null, inboundShipmentId: null,
        vendorReceiveSession: { status: "CANCELLED" },
        location: { branch: { orgId: 1 } },
        lines: [{ id: 1, variantId: 1, quantity: 10 }],
      });

      await expect(
        grnService.receiveGrn(1, 1, 100)
      ).rejects.toThrow("cancelled");
    });

    it("throws if GRN is VOIDED", async () => {
      prismaMock.grn.findFirst.mockResolvedValue({
        id: 1, orgId: 1, status: "VOIDED",
        vendorId: 1, purchaseOrderId: null, stockDispatchId: null, inboundShipmentId: null,
        vendorReceiveSession: { status: "DRAFT" },
        location: { branch: { orgId: 1 } },
        lines: [],
      });

      await expect(
        grnService.receiveGrn(1, 1, 100)
      ).rejects.toThrow("voided");
    });
  });

  describe("getOrgIdsForUser — branch staff", () => {
    it("returns distinct org ids from active BranchMember when not org owner or OrgMember", async () => {
      prismaMock.organization.findMany.mockResolvedValue([]);
      prismaMock.orgMember.findFirst.mockResolvedValue(null);
      prismaMock.branchMember.findMany.mockResolvedValue([{ orgId: 7 }, { orgId: 8 }]);
      const ids = await grnService.getOrgIdsForUser(42);
      expect(ids.sort()).toEqual([7, 8]);
      expect(prismaMock.branchMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 42, status: "ACTIVE" }) })
      );
    });
  });

  describe("getPendingVendorReceiveCountsForBranch", () => {
    it("counts AWAITING_CONFIRMATION and DRAFT sessions for branch locations", async () => {
      prismaMock.branch.findFirst.mockResolvedValue({ id: 5 });
      prismaMock.inventoryLocation.findMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
      prismaMock.grn.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
      const r = await grnService.getPendingVendorReceiveCountsForBranch(1, 5);
      expect(r.awaitingConfirmation).toBe(3);
      expect(r.draftVendorReceives).toBe(2);
      expect(prismaMock.grn.count).toHaveBeenCalled();
    });
  });

  describe("listGrns — sessionStatus filter", () => {
    it("filters by vendorReceiveSession status when sessionStatus is provided", async () => {
      prismaMock.grn.findMany.mockResolvedValue([]);
      prismaMock.grn.count.mockResolvedValue(0);

      await grnService.listGrns({
        orgId: 1,
        status: "DRAFT",
        sessionStatus: "AWAITING_CONFIRMATION",
      });

      expect(prismaMock.grn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "DRAFT",
            vendorReceiveSession: { status: "AWAITING_CONFIRMATION" },
          }),
        })
      );
    });

    it("includes vendorReceiveSession in list results", async () => {
      prismaMock.grn.findMany.mockResolvedValue([]);
      prismaMock.grn.count.mockResolvedValue(0);

      await grnService.listGrns({ orgId: 1 });

      expect(prismaMock.grn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            vendorReceiveSession: expect.any(Object),
          }),
        })
      );
    });
  });
});
