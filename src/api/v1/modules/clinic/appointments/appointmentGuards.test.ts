/**
 * Regression tests for requireAppointmentInBranch after the fix that merges
 * orgId/branchId into the select so branch validation works with custom selects.
 */
const findUniqueMock = jest.fn();

jest.mock("../../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {
    appointment: { findUnique: findUniqueMock },
  },
}));

const { requireAppointmentInBranch, AppointmentNotFoundError } = require("./appointmentGuards");

describe("requireAppointmentInBranch (regression after merged select fix)", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
  });

  describe("1. Custom select without orgId/branchId (collect-payment style) — should succeed when data matches", () => {
    it("returns appointment when select has only id and paymentStatus and row matches branch", async () => {
      findUniqueMock.mockResolvedValue({
        id: 8,
        paymentStatus: "UNPAID",
        orgId: 1,
        branchId: 5,
      });
      const result = await requireAppointmentInBranch({
        appointmentId: 8,
        orgId: 1,
        branchId: 5,
        select: { id: true, paymentStatus: true },
      });
      expect(findUniqueMock).toHaveBeenCalledWith({
        where: { id: 8 },
        select: { id: true, paymentStatus: true, orgId: true, branchId: true },
      });
      expect(result).toEqual({
        id: 8,
        paymentStatus: "UNPAID",
        orgId: 1,
        branchId: 5,
      });
      expect(result.paymentStatus).toBe("UNPAID");
    });
  });

  describe("2. Assign-doctor style select (id, doctorId, status) — should succeed when data matches", () => {
    it("returns appointment when select has id, doctorId, status and row matches branch", async () => {
      findUniqueMock.mockResolvedValue({
        id: 8,
        doctorId: 2,
        status: "PRE_BOOKED",
        orgId: 1,
        branchId: 5,
      });
      const result = await requireAppointmentInBranch({
        appointmentId: 8,
        orgId: 1,
        branchId: 5,
        select: { id: true, doctorId: true, status: true },
      });
      expect(findUniqueMock).toHaveBeenCalledWith({
        where: { id: 8 },
        select: { id: true, doctorId: true, status: true, orgId: true, branchId: true },
      });
      expect(result.doctorId).toBe(2);
      expect(result.status).toBe("PRE_BOOKED");
    });
  });

  describe("3. No custom select (default) — should still work", () => {
    it("uses default select with id, status and merged orgId, branchId", async () => {
      findUniqueMock.mockResolvedValue({
        id: 8,
        status: "PRE_BOOKED",
        orgId: 1,
        branchId: 5,
      });
      const result = await requireAppointmentInBranch({
        appointmentId: 8,
        orgId: 1,
        branchId: 5,
      });
      expect(findUniqueMock).toHaveBeenCalledWith({
        where: { id: 8 },
        select: { id: true, status: true, orgId: true, branchId: true },
      });
      expect(result.status).toBe("PRE_BOOKED");
    });
  });

  describe("4. Missing appointment id — should throw 404", () => {
    it("throws AppointmentNotFoundError when findUnique returns null", async () => {
      findUniqueMock.mockResolvedValue(null);
      await expect(
        requireAppointmentInBranch({
          appointmentId: 999,
          orgId: 1,
          branchId: 5,
          select: { id: true, paymentStatus: true },
        })
      ).rejects.toThrow("Appointment not found");
      const err = await requireAppointmentInBranch({
        appointmentId: 999,
        orgId: 1,
        branchId: 5,
      }).catch((e: any) => e);
      expect(err).toBeInstanceOf(AppointmentNotFoundError);
      expect(err.statusCode).toBe(404);
    });
  });

  describe("5. Wrong branch — should throw 404", () => {
    it("throws when appointment belongs to different branch", async () => {
      findUniqueMock.mockResolvedValue({
        id: 8,
        paymentStatus: "UNPAID",
        orgId: 1,
        branchId: 99,
      });
      await expect(
        requireAppointmentInBranch({
          appointmentId: 8,
          orgId: 1,
          branchId: 5,
          select: { id: true, paymentStatus: true },
        })
      ).rejects.toThrow("Appointment not found");
      const err = await requireAppointmentInBranch({
        appointmentId: 8,
        orgId: 1,
        branchId: 5,
      }).catch((e: any) => e);
      expect(err).toBeInstanceOf(AppointmentNotFoundError);
      expect(err.statusCode).toBe(404);
    });

    it("throws when appointment belongs to different org", async () => {
      findUniqueMock.mockResolvedValue({
        id: 8,
        paymentStatus: "UNPAID",
        orgId: 2,
        branchId: 5,
      });
      await expect(
        requireAppointmentInBranch({
          appointmentId: 8,
          orgId: 1,
          branchId: 5,
          select: { id: true, paymentStatus: true },
        })
      ).rejects.toThrow("Appointment not found");
    });
  });

  describe("6. Caller compatibility — returned object has requested fields plus orgId/branchId", () => {
    it("caller can still use only requested fields (e.g. paymentStatus) without breakage", async () => {
      findUniqueMock.mockResolvedValue({
        id: 8,
        paymentStatus: "UNPAID",
        orgId: 1,
        branchId: 5,
      });
      const apt = await requireAppointmentInBranch({
        appointmentId: 8,
        orgId: 1,
        branchId: 5,
        select: { id: true, paymentStatus: true },
      });
      expect(apt.id).toBe(8);
      expect(apt.paymentStatus).toBe("UNPAID");
      expect(apt.orgId).toBe(1);
      expect(apt.branchId).toBe(5);
    });
  });
});
