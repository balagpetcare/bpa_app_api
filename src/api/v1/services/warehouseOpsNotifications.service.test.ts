/**
 * Warehouse ops notifications: manager deep link and PO enrichment for vendor receive.
 * Run: npx jest warehouseOpsNotifications.service.test.ts
 */
jest.mock("../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {
    organization: { findUnique: jest.fn() },
    grn: { findUnique: jest.fn() },
    branchMember: { findMany: jest.fn() },
  },
}));

jest.mock("./notification.service", () => ({
  createNotification: jest.fn().mockResolvedValue({ notification: { id: 1 }, created: true }),
}));

const prismaMock = require("../../../infrastructure/db/prismaClient").default;
const { createNotification } = require("./notification.service");
const {
  notifyVendorReceiveSubmittedForConfirmation,
} = require("./warehouseOpsNotifications.service");

describe("warehouseOpsNotifications.notifyVendorReceiveSubmittedForConfirmation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.organization.findUnique.mockResolvedValue({ ownerUserId: 10 });
    prismaMock.branchMember.findMany.mockResolvedValue([{ userId: 200 }]);
  });

  it("sends branch managers a staff receive-po detail URL and includes PO ref in message", async () => {
    prismaMock.grn.findUnique
      .mockResolvedValueOnce({ location: { branch: { id: 7 } } })
      .mockResolvedValueOnce({
        vendor: { name: "Acme Supplies" },
        purchaseOrder: { poNumber: "PO-1001" },
        location: { name: "Main WH", branch: { name: "North" } },
        lines: [{ quantity: 12 }, { quantity: 3 }],
      });

    await notifyVendorReceiveSubmittedForConfirmation({ orgId: 1, grnId: 55, actorUserId: 99 });

    const mgrCall = (createNotification as jest.Mock).mock.calls.find(
      (c) => c[0]?.dedupeKey === "vendor_receive_submit_mgr:55"
    );
    expect(mgrCall).toBeTruthy();
    expect(mgrCall[0].title).toBe("Vendor receive awaiting confirmation");
    expect(mgrCall[0].actionUrl).toBe("/staff/branch/7/warehouse/vendor-receipts/55");
    expect(mgrCall[0].message).toContain("PO-1001");
    expect(mgrCall[0].message).toContain("GRN #55");
    expect(mgrCall[0].branchId).toBe(7);
    expect(mgrCall[0].meta).toMatchObject({ grnId: 55, poNumber: "PO-1001" });
  });
});
