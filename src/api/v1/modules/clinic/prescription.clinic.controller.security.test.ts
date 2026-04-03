/**
 * Integration-style security tests for clinic prescription controller handlers.
 * Exercises branch binding, prescriber checks, draft immutability, and dispense preconditions
 * with mocked Prisma + prescription.service (no HTTP server).
 */
const mockVisitFindFirst = jest.fn();
const mockGetRx = jest.fn();
const mockUpdateRx = jest.fn();
const mockFinalizeRx = jest.fn();
const mockMarkDispensed = jest.fn();

jest.mock("../../../../infrastructure/db/prismaClient", () => {
  const client = { visit: { findFirst: (...args: unknown[]) => mockVisitFindFirst(...args) } };
  return Object.assign(client, { default: client });
});

jest.mock("./prescription.service", () => ({
  getPrescriptionById: (...args: unknown[]) => mockGetRx(...args),
  updatePrescription: (...args: unknown[]) => mockUpdateRx(...args),
  finalizePrescription: (...args: unknown[]) => mockFinalizeRx(...args),
  markDispensed: (...args: unknown[]) => mockMarkDispensed(...args),
}));

const { CLINIC_ERROR_CODES } = require("./clinic.responses");
const ctrl = require("./clinic.controller");

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("clinic.controller prescription security", () => {
  beforeEach(() => {
    mockVisitFindFirst.mockReset();
    mockGetRx.mockReset();
    mockUpdateRx.mockReset();
    mockFinalizeRx.mockReset();
    mockMarkDispensed.mockReset();
  });

  describe("createPrescription (vet middleware runs before controller; controller still requires doctor context)", () => {
    it("returns 403 when clinicDoctorBranchMemberId missing (nurse never receives this from middleware)", async () => {
      const res = mockRes();
      const req: any = {
        params: { branchId: "1", visitId: "10" },
        user: { id: 1 },
        body: { items: [{ medicineName: "x", dosage: "1", frequency: "qd", duration: "7d" }] },
      };
      await ctrl.createPrescription(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, code: CLINIC_ERROR_CODES.PRESCRIPTION_FORBIDDEN })
      );
      expect(mockVisitFindFirst).not.toHaveBeenCalled();
    });

    it("returns 403 when visit assigned doctor differs from authenticated vet branch member", async () => {
      const res = mockRes();
      mockVisitFindFirst.mockResolvedValue({ id: 10, petId: 99, doctorId: 200 });
      const req: any = {
        params: { branchId: "1", visitId: "10" },
        user: { id: 1 },
        clinicDoctorBranchMemberId: 100,
        body: { items: [{ medicineName: "x", dosage: "1", frequency: "qd", duration: "7d" }] },
      };
      await ctrl.createPrescription(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: CLINIC_ERROR_CODES.PRESCRIPTION_FORBIDDEN }));
    });
  });

  describe("getPrescription (cross-branch read)", () => {
    it("returns 404 when prescription visit is on another branch", async () => {
      mockGetRx.mockResolvedValue({ id: 5, visit: { branchId: 99 } });
      const res = mockRes();
      const req: any = { params: { branchId: "1", prescriptionId: "5" } };
      await ctrl.getPrescription(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: CLINIC_ERROR_CODES.NOT_FOUND }));
    });
  });

  describe("updatePrescription", () => {
    it("returns 404 for cross-branch prescription", async () => {
      mockGetRx.mockResolvedValue({ id: 1, doctorId: 10, status: "DRAFT", visit: { branchId: 2 } });
      const res = mockRes();
      const req: any = {
        params: { branchId: "1", prescriptionId: "1" },
        clinicDoctorBranchMemberId: 10,
        body: { notes: "x" },
      };
      await ctrl.updatePrescription(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("returns 409 PRESCRIPTION_NOT_EDITABLE when prescription is FINALIZED", async () => {
      mockGetRx.mockResolvedValue({ id: 1, doctorId: 10, status: "FINALIZED", visit: { branchId: 1 } });
      const res = mockRes();
      const req: any = {
        params: { branchId: "1", prescriptionId: "1" },
        clinicDoctorBranchMemberId: 10,
        body: { notes: "hack" },
      };
      await ctrl.updatePrescription(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: CLINIC_ERROR_CODES.PRESCRIPTION_NOT_EDITABLE })
      );
      expect(mockUpdateRx).not.toHaveBeenCalled();
    });

    it("returns 403 when vet is not the prescriber", async () => {
      mockGetRx.mockResolvedValue({ id: 1, doctorId: 99, status: "DRAFT", visit: { branchId: 1 } });
      const res = mockRes();
      const req: any = {
        params: { branchId: "1", prescriptionId: "1" },
        clinicDoctorBranchMemberId: 10,
        body: {},
      };
      await ctrl.updatePrescription(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockUpdateRx).not.toHaveBeenCalled();
    });
  });

  describe("finalizePrescription", () => {
    it("returns 409 when not DRAFT", async () => {
      mockGetRx.mockResolvedValue({ id: 1, doctorId: 10, status: "FINALIZED", visit: { branchId: 1 } });
      const res = mockRes();
      const req: any = {
        params: { branchId: "1", prescriptionId: "1" },
        clinicDoctorBranchMemberId: 10,
      };
      await ctrl.finalizePrescription(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockFinalizeRx).not.toHaveBeenCalled();
    });
  });

  describe("dispensePrescription", () => {
    it("returns 400 when markDispensed rejects (e.g. prescription not FINALIZED)", async () => {
      mockGetRx.mockResolvedValue({ id: 1, visit: { branchId: 1 }, status: "DRAFT" });
      mockMarkDispensed.mockResolvedValue(null);
      const res = mockRes();
      const req: any = {
        params: { branchId: "1", prescriptionId: "1" },
        user: { id: 5 },
        body: {},
      };
      await ctrl.dispensePrescription(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: CLINIC_ERROR_CODES.NOT_FOUND }));
    });

    it("returns 404 when prescription belongs to another branch", async () => {
      mockGetRx.mockResolvedValue({ id: 1, visit: { branchId: 9 } });
      const res = mockRes();
      const req: any = { params: { branchId: "1", prescriptionId: "1" }, user: { id: 5 }, body: {} };
      await ctrl.dispensePrescription(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockMarkDispensed).not.toHaveBeenCalled();
    });
  });
});
