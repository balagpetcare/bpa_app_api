/**
 * Security tests for doctor panel prescription update/finalize (prescriber ownership + DRAFT).
 */
const mockFindUnique = jest.fn();
const mockGetDoctorIds = jest.fn();
const mockUpdateByDoctor = jest.fn();
const mockFinalizeByDoctor = jest.fn();

jest.mock("../../../../infrastructure/db/prismaClient", () => {
  const client = { prescription: { findUnique: (...args: unknown[]) => mockFindUnique(...args) } };
  return Object.assign(client, { default: client });
});

jest.mock("./doctor.service", () => ({
  getDoctorBranchMemberIds: (...args: unknown[]) => mockGetDoctorIds(...args),
  updatePrescriptionByDoctor: (...args: unknown[]) => mockUpdateByDoctor(...args),
  finalizePrescriptionByDoctor: (...args: unknown[]) => mockFinalizeByDoctor(...args),
}));

const doctorCtrl = require("./doctor.controller");

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("doctor.controller prescription security", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockGetDoctorIds.mockReset();
    mockUpdateByDoctor.mockReset();
    mockFinalizeByDoctor.mockReset();
  });

  it("updatePrescription returns 403 when prescription belongs to another doctor", async () => {
    mockGetDoctorIds.mockResolvedValue([100, 101]);
    mockFindUnique.mockResolvedValue({ id: 7, doctorId: 999, status: "DRAFT" });
    const res = mockRes();
    const req: any = { user: { id: 1 }, params: { prescriptionId: "7" }, body: { notes: "x" } };
    await doctorCtrl.updatePrescription(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockUpdateByDoctor).not.toHaveBeenCalled();
  });

  it("updatePrescription returns 409 when not DRAFT", async () => {
    mockGetDoctorIds.mockResolvedValue([100]);
    mockFindUnique.mockResolvedValue({ id: 7, doctorId: 100, status: "FINALIZED" });
    const res = mockRes();
    const req: any = { user: { id: 1 }, params: { prescriptionId: "7" }, body: {} };
    await doctorCtrl.updatePrescription(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "PRESCRIPTION_NOT_EDITABLE" }));
    expect(mockUpdateByDoctor).not.toHaveBeenCalled();
  });

  it("finalizePrescription returns 403 when not prescriber", async () => {
    mockGetDoctorIds.mockResolvedValue([100]);
    mockFindUnique.mockResolvedValue({ id: 7, doctorId: 200, status: "DRAFT" });
    const res = mockRes();
    const req: any = { user: { id: 1 }, params: { prescriptionId: "7" } };
    await doctorCtrl.finalizePrescription(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockFinalizeByDoctor).not.toHaveBeenCalled();
  });
});
