/**
 * Dispatch notifications tests: actionUrl uses destination toBranchId only.
 * Run with: npx jest dispatches.notifications.test.ts
 */
jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {
    organization: { findUnique: jest.fn() },
  },
}));

jest.mock("../../services/notification.service", () => ({
  createNotification: jest.fn().mockResolvedValue({ notification: { id: 1 }, created: true }),
}));

const prismaMock = require("../../../../infrastructure/db/prismaClient").default;
const { createNotification } = require("../../services/notification.service");
const { notifyDispatchReceived } = require("./dispatches.notifications");

describe("dispatches.notifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.organization.findUnique.mockResolvedValue({ ownerUserId: 100 });
  });

  describe("notifyDispatchReceived", () => {
    it("uses toBranchId from params for actionUrl (destination branch only)", async () => {
      const dispatchId = 42;
      const toBranchId = 7;
      await notifyDispatchReceived({
        dispatchId,
        dispatch: {
          orgId: 1,
          createdByUserId: 2,
          fromLocation: { name: "Warehouse A" },
          toLocation: { name: "Branch B" },
        },
        result: { grn: { lines: [{ quantity: 10 }] } },
        receiverUserId: 3,
        toBranchId,
      });

      expect(createNotification).toHaveBeenCalled();
      const calls = (createNotification as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const firstCall = calls[0][0];
      expect(firstCall.actionUrl).toBe(`/staff/branch/${toBranchId}/inventory/incoming/${dispatchId}`);
    });

    it("actionUrl format is /staff/branch/{toBranchId}/inventory/incoming/{dispatchId}", async () => {
      await notifyDispatchReceived({
        dispatchId: 123,
        dispatch: {
          orgId: 1,
          fromLocation: { name: "From" },
          toLocation: { name: "To" },
        },
        result: { grn: { lines: [] } },
        receiverUserId: 1,
        toBranchId: 99,
      });

      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          actionUrl: "/staff/branch/99/inventory/incoming/123",
        })
      );
    });

    it("omits actionUrl when toBranchId is null", async () => {
      await notifyDispatchReceived({
        dispatchId: 1,
        dispatch: {
          orgId: 1,
          fromLocation: { name: "A" },
          toLocation: { name: "B" },
        },
        result: { grn: { lines: [{ quantity: 1 }] } },
        receiverUserId: 1,
        toBranchId: null,
      });

      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          actionUrl: null,
        })
      );
    });
  });
});
